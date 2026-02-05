'use strict';

import { Router } from 'express';
import { getDatabase } from '../database.mjs';
import { requireAuth } from '../middleware/auth.mjs';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/sessions
 * List all sessions for the current user.
 *
 * Query params:
 *   - showHidden: '1' to include archived/agent sessions, '0' or omit to exclude (default)
 *   - search: search term to filter by session name or message content
 */
router.get('/', (req, res) => {
  let db          = getDatabase();
  let showHidden  = req.query.showHidden === '1' || req.query.archived === '1'; // Support legacy param
  let searchQuery = req.query.search?.trim() || '';

  let params = [req.user.id];
  let whereClause = 's.user_id = ?';

  // Filter by status - hide archived/agent sessions unless showHidden is true
  if (!showHidden) {
    whereClause += ' AND (s.status IS NULL)';
  }

  // Search filter
  if (searchQuery) {
    whereClause += ` AND (
      s.name LIKE ?
      OR EXISTS (
        SELECT 1 FROM messages m
        WHERE m.session_id = s.id AND m.content LIKE ?
      )
    )`;
    let searchPattern = `%${searchQuery}%`;
    params.push(searchPattern, searchPattern);
  }

  let sessions = db.prepare(`
    SELECT
      s.id,
      s.name,
      s.system_prompt,
      s.status,
      s.parent_session_id,
      s.created_at,
      s.updated_at,
      a.id as agent_id,
      a.name as agent_name,
      a.type as agent_type,
      (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as message_count,
      (SELECT content FROM messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_message
    FROM sessions s
    JOIN agents a ON s.agent_id = a.id
    WHERE ${whereClause}
    ORDER BY s.updated_at DESC
  `).all(...params);

  // Build hierarchy: group child sessions under their parents
  let sessionMap = new Map();
  let rootSessions = [];
  let childSessions = new Map(); // parentId -> [children]

  // First pass: build lookup maps
  for (let s of sessions) {
    sessionMap.set(s.id, s);
    if (s.parent_session_id) {
      if (!childSessions.has(s.parent_session_id))
        childSessions.set(s.parent_session_id, []);
      childSessions.get(s.parent_session_id).push(s);
    } else {
      rootSessions.push(s);
    }
  }

  // Second pass: build ordered list with children following parents
  let orderedSessions = [];

  function addWithChildren(session, depth = 0) {
    session._depth = depth;
    orderedSessions.push(session);

    let children = childSessions.get(session.id) || [];
    // Sort children by updated_at descending
    children.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    for (let child of children)
      addWithChildren(child, depth + 1);
  }

  for (let root of rootSessions)
    addWithChildren(root);

  return res.json({
    sessions: orderedSessions.map((s) => {
      // Parse last message to get preview
      let preview = '';
      if (s.last_message) {
        try {
          let content = JSON.parse(s.last_message);
          if (typeof content === 'string') {
            preview = content.substring(0, 100);
          } else if (Array.isArray(content)) {
            let textBlock = content.find((b) => b.type === 'text');
            if (textBlock)
              preview = textBlock.text.substring(0, 100);
          }
        } catch (e) {
          preview = '';
        }
      }

      return {
        id:              s.id,
        name:            s.name,
        systemPrompt:    s.system_prompt,
        status:          s.status,
        parentSessionId: s.parent_session_id,
        depth:           s._depth || 0,
        // Legacy support
        archived:        s.status === 'archived',
        agent:           {
          id:   s.agent_id,
          name: s.agent_name,
          type: s.agent_type,
        },
        messageCount: s.message_count,
        preview:      preview,
        createdAt:    s.created_at,
        updatedAt:    s.updated_at,
      };
    }),
  });
});

/**
 * POST /api/sessions
 * Create a new session.
 */
router.post('/', (req, res) => {
  let { name, agentId, systemPrompt, status, parentSessionId } = req.body;

  if (!name || !agentId)
    return res.status(400).json({ error: 'Name and agentId are required' });

  let db = getDatabase();

  // Verify agent exists and belongs to user
  let agent = db.prepare('SELECT id, name, type FROM agents WHERE id = ? AND user_id = ?').get(agentId, req.user.id);

  if (!agent)
    return res.status(404).json({ error: 'Agent not found' });

  // Verify parent session exists if provided
  if (parentSessionId) {
    let parent = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(parentSessionId, req.user.id);
    if (!parent)
      return res.status(404).json({ error: 'Parent session not found' });
  }

  // Check for duplicate name
  let existing = db.prepare('SELECT id FROM sessions WHERE user_id = ? AND name = ?').get(req.user.id, name);

  if (existing)
    return res.status(409).json({ error: `Session "${name}" already exists` });

  try {
    let result = db.prepare(`
      INSERT INTO sessions (user_id, agent_id, name, system_prompt, status, parent_session_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user.id, agentId, name, systemPrompt || null, status || null, parentSessionId || null);

    return res.status(201).json({
      id:              result.lastInsertRowid,
      name:            name,
      systemPrompt:    systemPrompt || null,
      status:          status || null,
      parentSessionId: parentSessionId || null,
      depth:           0,
      archived:        status === 'archived',
      agent:           {
        id:   agent.id,
        name: agent.name,
        type: agent.type,
      },
      messageCount: 0,
      createdAt:    new Date().toISOString(),
      updatedAt:    new Date().toISOString(),
    });
  } catch (error) {
    console.error('Create session error:', error);
    return res.status(500).json({ error: 'Failed to create session' });
  }
});

/**
 * GET /api/sessions/:id
 * Get a specific session with messages.
 */
router.get('/:id', (req, res) => {
  let db      = getDatabase();
  let session = db.prepare(`
    SELECT
      s.id,
      s.name,
      s.system_prompt,
      s.status,
      s.parent_session_id,
      s.created_at,
      s.updated_at,
      a.id as agent_id,
      a.name as agent_name,
      a.type as agent_type
    FROM sessions s
    JOIN agents a ON s.agent_id = a.id
    WHERE s.id = ? AND s.user_id = ?
  `).get(req.params.id, req.user.id);

  if (!session)
    return res.status(404).json({ error: 'Session not found' });

  let messages = db.prepare(`
    SELECT id, role, content, hidden, created_at
    FROM messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(req.params.id);

  return res.json({
    id:              session.id,
    name:            session.name,
    systemPrompt:    session.system_prompt,
    status:          session.status,
    parentSessionId: session.parent_session_id,
    archived:        session.status === 'archived',
    agent:           {
      id:   session.agent_id,
      name: session.agent_name,
      type: session.agent_type,
    },
    messages:  messages.map((m) => ({
      id:        m.id,
      role:      m.role,
      content:   JSON.parse(m.content),
      hidden:    !!m.hidden,
      createdAt: m.created_at,
    })),
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  });
});

/**
 * PUT /api/sessions/:id
 * Update a session.
 */
router.put('/:id', (req, res) => {
  let { name, systemPrompt, agentId } = req.body;

  let db      = getDatabase();
  let session = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);

  if (!session)
    return res.status(404).json({ error: 'Session not found' });

  let updates = [];
  let values  = [];

  if (name !== undefined) {
    // Check for duplicate name (excluding current session)
    let existing = db.prepare('SELECT id FROM sessions WHERE user_id = ? AND name = ? AND id != ?').get(req.user.id, name, req.params.id);

    if (existing)
      return res.status(409).json({ error: `Session "${name}" already exists` });

    updates.push('name = ?');
    values.push(name);
  }

  if (systemPrompt !== undefined) {
    updates.push('system_prompt = ?');
    values.push(systemPrompt || null);
  }

  if (agentId !== undefined) {
    // Verify agent exists and belongs to user
    let agent = db.prepare('SELECT id FROM agents WHERE id = ? AND user_id = ?').get(agentId, req.user.id);

    if (!agent)
      return res.status(404).json({ error: 'Agent not found' });

    updates.push('agent_id = ?');
    values.push(agentId);
  }

  if (updates.length === 0)
    return res.status(400).json({ error: 'No fields to update' });

  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(req.params.id);
  values.push(req.user.id);

  db.prepare(`
    UPDATE sessions
    SET ${updates.join(', ')}
    WHERE id = ? AND user_id = ?
  `).run(...values);

  return res.json({ success: true });
});

/**
 * DELETE /api/sessions/:id
 * Delete a session and all its messages.
 */
router.delete('/:id', (req, res) => {
  let db     = getDatabase();
  let result = db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);

  if (result.changes === 0)
    return res.status(404).json({ error: 'Session not found' });

  return res.json({ success: true });
});

/**
 * POST /api/sessions/:id/archive
 * Archive a session (soft delete).
 */
router.post('/:id/archive', (req, res) => {
  let db      = getDatabase();
  let session = db.prepare('SELECT id, status FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);

  if (!session)
    return res.status(404).json({ error: 'Session not found' });

  db.prepare(`
    UPDATE sessions
    SET status = 'archived', updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(req.params.id, req.user.id);

  return res.json({ success: true, status: 'archived', archived: true });
});

/**
 * POST /api/sessions/:id/unarchive
 * Unarchive a session (restore to normal).
 */
router.post('/:id/unarchive', (req, res) => {
  let db      = getDatabase();
  let session = db.prepare('SELECT id, status FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);

  if (!session)
    return res.status(404).json({ error: 'Session not found' });

  db.prepare(`
    UPDATE sessions
    SET status = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(req.params.id, req.user.id);

  return res.json({ success: true, status: null, archived: false });
});

/**
 * PUT /api/sessions/:id/status
 * Update session status.
 */
router.put('/:id/status', (req, res) => {
  let { status } = req.body;

  let db      = getDatabase();
  let session = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);

  if (!session)
    return res.status(404).json({ error: 'Session not found' });

  db.prepare(`
    UPDATE sessions
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(status || null, req.params.id, req.user.id);

  return res.json({ success: true, status: status || null });
});

export default router;
