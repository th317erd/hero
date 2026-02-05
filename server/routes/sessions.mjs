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
 */
router.get('/', (req, res) => {
  let db       = getDatabase();
  let sessions = db.prepare(`
    SELECT
      s.id,
      s.name,
      s.system_prompt,
      s.created_at,
      s.updated_at,
      a.id as agent_id,
      a.name as agent_name,
      a.type as agent_type,
      (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as message_count
    FROM sessions s
    JOIN agents a ON s.agent_id = a.id
    WHERE s.user_id = ?
    ORDER BY s.updated_at DESC
  `).all(req.user.id);

  return res.json({
    sessions: sessions.map((s) => ({
      id:           s.id,
      name:         s.name,
      systemPrompt: s.system_prompt,
      agent:        {
        id:   s.agent_id,
        name: s.agent_name,
        type: s.agent_type,
      },
      messageCount: s.message_count,
      createdAt:    s.created_at,
      updatedAt:    s.updated_at,
    })),
  });
});

/**
 * POST /api/sessions
 * Create a new session.
 */
router.post('/', (req, res) => {
  let { name, agentId, systemPrompt } = req.body;

  if (!name || !agentId)
    return res.status(400).json({ error: 'Name and agentId are required' });

  let db = getDatabase();

  // Verify agent exists and belongs to user
  let agent = db.prepare('SELECT id, name, type FROM agents WHERE id = ? AND user_id = ?').get(agentId, req.user.id);

  if (!agent)
    return res.status(404).json({ error: 'Agent not found' });

  // Check for duplicate name
  let existing = db.prepare('SELECT id FROM sessions WHERE user_id = ? AND name = ?').get(req.user.id, name);

  if (existing)
    return res.status(409).json({ error: `Session "${name}" already exists` });

  try {
    let result = db.prepare(`
      INSERT INTO sessions (user_id, agent_id, name, system_prompt)
      VALUES (?, ?, ?, ?)
    `).run(req.user.id, agentId, name, systemPrompt || null);

    return res.status(201).json({
      id:           result.lastInsertRowid,
      name:         name,
      systemPrompt: systemPrompt || null,
      agent:        {
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
    SELECT id, role, content, created_at
    FROM messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(req.params.id);

  return res.json({
    id:           session.id,
    name:         session.name,
    systemPrompt: session.system_prompt,
    agent:        {
      id:   session.agent_id,
      name: session.agent_name,
      type: session.agent_type,
    },
    messages:  messages.map((m) => ({
      id:        m.id,
      role:      m.role,
      content:   JSON.parse(m.content),
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

export default router;
