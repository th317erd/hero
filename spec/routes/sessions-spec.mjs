'use strict';

// ============================================================================
// Sessions API Tests
// ============================================================================
// Tests for the sessions REST API endpoints.
// Tests SQL operations directly using in-memory SQLite (no HTTP mocking).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// ============================================================================
// Test Database Setup
// ============================================================================

let db = null;

function createTestDatabase() {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'claude',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      system_prompt TEXT,
      status TEXT,
      parent_session_id INTEGER,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE frames (
      id TEXT PRIMARY KEY,
      session_id INTEGER NOT NULL,
      parent_id TEXT,
      target_ids TEXT,
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      author_type TEXT NOT NULL,
      author_id INTEGER,
      payload TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_frames_session ON frames(session_id, timestamp);
  `);

  // Seed two users, each with an agent
  db.prepare("INSERT INTO users (id, username) VALUES (1, 'alice')").run();
  db.prepare("INSERT INTO users (id, username) VALUES (2, 'bob')").run();
  db.prepare("INSERT INTO agents (id, user_id, name, type) VALUES (1, 1, 'AliceAgent', 'claude')").run();
  db.prepare("INSERT INTO agents (id, user_id, name, type) VALUES (2, 2, 'BobAgent', 'claude')").run();

  return db;
}

// ============================================================================
// Helper: insert a session directly
// ============================================================================

function insertSession(fields) {
  let {
    userId,
    agentId,
    name,
    systemPrompt = null,
    status = null,
    parentSessionId = null,
    updatedAt = null,
  } = fields;

  let result;

  if (updatedAt) {
    result = db.prepare(`
      INSERT INTO sessions (user_id, agent_id, name, system_prompt, status, parent_session_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, agentId, name, systemPrompt, status, parentSessionId, updatedAt);
  } else {
    result = db.prepare(`
      INSERT INTO sessions (user_id, agent_id, name, system_prompt, status, parent_session_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, agentId, name, systemPrompt, status, parentSessionId);
  }

  return result.lastInsertRowid;
}

// ============================================================================
// Helper: insert a message frame directly
// ============================================================================

let frameCounter = 0;

function insertMessageFrame(sessionId, content, authorType = 'user', timestamp = null) {
  frameCounter++;
  let id = `msg-${frameCounter}`;
  let ts = timestamp || new Date(Date.now() + frameCounter).toISOString();
  let payload = JSON.stringify(content);

  db.prepare(`
    INSERT INTO frames (id, session_id, timestamp, type, author_type, payload)
    VALUES (?, ?, ?, 'message', ?, ?)
  `).run(id, sessionId, ts, authorType, payload);

  return id;
}

// ============================================================================
// Helper: simulate the list sessions query (mirrors GET / handler)
// ============================================================================

function listSessions(userId, searchQuery = '') {
  let params = [userId];
  let whereClause = 's.user_id = ?';

  if (searchQuery) {
    whereClause += ` AND (
      s.name LIKE ?
      OR EXISTS (
        SELECT 1 FROM frames f
        WHERE f.session_id = s.id AND f.type = 'message' AND f.payload LIKE ?
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
      (SELECT COUNT(*) FROM frames WHERE session_id = s.id AND type = 'message') as message_count,
      (SELECT payload FROM frames WHERE session_id = s.id AND type = 'message' ORDER BY timestamp DESC LIMIT 1) as last_message
    FROM sessions s
    JOIN agents a ON s.agent_id = a.id
    WHERE ${whereClause}
    ORDER BY s.updated_at DESC
  `).all(...params);

  // Build hierarchy
  let rootSessions = [];
  let childSessions = new Map();

  for (let s of sessions) {
    if (s.parent_session_id) {
      if (!childSessions.has(s.parent_session_id))
        childSessions.set(s.parent_session_id, []);
      childSessions.get(s.parent_session_id).push(s);
    } else {
      rootSessions.push(s);
    }
  }

  let orderedSessions = [];

  function addWithChildren(session, depth = 0) {
    session._depth = depth;
    orderedSessions.push(session);

    let children = childSessions.get(session.id) || [];
    children.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    for (let child of children)
      addWithChildren(child, depth + 1);
  }

  for (let root of rootSessions)
    addWithChildren(root);

  return orderedSessions.map((s) => {
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
  });
}

// ============================================================================
// Helper: simulate create session (mirrors POST / handler)
// ============================================================================

function createSession(userId, body) {
  let { name, agentId, systemPrompt, status, parentSessionId } = body;

  if (!name || !agentId)
    return { status: 400, body: { error: 'Name and agentId are required' } };

  let agent = db.prepare('SELECT id, name, type FROM agents WHERE id = ? AND user_id = ?').get(agentId, userId);
  if (!agent)
    return { status: 404, body: { error: 'Agent not found' } };

  if (parentSessionId) {
    let parent = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(parentSessionId, userId);
    if (!parent)
      return { status: 404, body: { error: 'Parent session not found' } };
  }

  let result = db.prepare(`
    INSERT INTO sessions (user_id, agent_id, name, system_prompt, status, parent_session_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, agentId, name, systemPrompt || null, status || null, parentSessionId || null);

  return {
    status: 201,
    body: {
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
    },
  };
}

// ============================================================================
// Helper: simulate get session (mirrors GET /:id handler)
// ============================================================================

function getSession(userId, sessionId) {
  let session = db.prepare(`
    SELECT
      s.id,
      s.name,
      s.system_prompt,
      s.status,
      s.parent_session_id,
      s.input_tokens,
      s.output_tokens,
      s.created_at,
      s.updated_at,
      a.id as agent_id,
      a.name as agent_name,
      a.type as agent_type
    FROM sessions s
    JOIN agents a ON s.agent_id = a.id
    WHERE s.id = ? AND s.user_id = ?
  `).get(sessionId, userId);

  if (!session)
    return { status: 404, body: { error: 'Session not found' } };

  let frames = db.prepare(`
    SELECT id, type, author_type, payload, timestamp
    FROM frames
    WHERE session_id = ? AND type = 'message'
    ORDER BY timestamp ASC
  `).all(sessionId);

  let messages = frames.map((f) => {
    let payload = JSON.parse(f.payload);
    let role = payload.role || ((f.author_type === 'agent') ? 'assistant' : 'user');
    return {
      id:        f.id,
      role:      role,
      content:   payload.content,
      hidden:    !!payload.hidden,
      type:      f.type,
      createdAt: f.timestamp,
      updatedAt: f.timestamp,
    };
  });

  return {
    status: 200,
    body: {
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
      cost: {
        inputTokens:  session.input_tokens || 0,
        outputTokens: session.output_tokens || 0,
      },
      messages:  messages,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    },
  };
}

// ============================================================================
// Helper: simulate update session (mirrors PUT /:id handler)
// ============================================================================

function updateSession(userId, sessionId, body) {
  let { name, systemPrompt, agentId } = body;

  let session = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
  if (!session)
    return { status: 404, body: { error: 'Session not found' } };

  let updates = [];
  let values  = [];

  if (name !== undefined) {
    updates.push('name = ?');
    values.push(name);
  }

  if (systemPrompt !== undefined) {
    updates.push('system_prompt = ?');
    values.push(systemPrompt || null);
  }

  if (agentId !== undefined) {
    let agent = db.prepare('SELECT id FROM agents WHERE id = ? AND user_id = ?').get(agentId, userId);
    if (!agent)
      return { status: 404, body: { error: 'Agent not found' } };

    updates.push('agent_id = ?');
    values.push(agentId);
  }

  if (updates.length === 0)
    return { status: 400, body: { error: 'No fields to update' } };

  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(sessionId);
  values.push(userId);

  db.prepare(`
    UPDATE sessions
    SET ${updates.join(', ')}
    WHERE id = ? AND user_id = ?
  `).run(...values);

  return { status: 200, body: { success: true } };
}

// ============================================================================
// Helper: simulate delete session (mirrors DELETE /:id handler)
// ============================================================================

function deleteSession(userId, sessionId) {
  let result = db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(sessionId, userId);

  if (result.changes === 0)
    return { status: 404, body: { error: 'Session not found' } };

  return { status: 200, body: { success: true } };
}

// ============================================================================
// Helper: simulate archive session (mirrors POST /:id/archive handler)
// ============================================================================

function archiveSession(userId, sessionId) {
  let session = db.prepare('SELECT id, status FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
  if (!session)
    return { status: 404, body: { error: 'Session not found' } };

  db.prepare(`
    UPDATE sessions
    SET status = 'archived', updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(sessionId, userId);

  return { status: 200, body: { success: true, status: 'archived', archived: true } };
}

// ============================================================================
// Helper: simulate unarchive session (mirrors POST /:id/unarchive handler)
// ============================================================================

function unarchiveSession(userId, sessionId) {
  let session = db.prepare('SELECT id, status FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
  if (!session)
    return { status: 404, body: { error: 'Session not found' } };

  db.prepare(`
    UPDATE sessions
    SET status = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(sessionId, userId);

  return { status: 200, body: { success: true, status: null, archived: false } };
}

// ============================================================================
// Helper: simulate status update (mirrors PUT /:id/status handler)
// ============================================================================

function updateSessionStatus(userId, sessionId, status) {
  let session = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
  if (!session)
    return { status: 404, body: { error: 'Session not found' } };

  db.prepare(`
    UPDATE sessions
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(status || null, sessionId, userId);

  return { status: 200, body: { success: true, status: status || null } };
}

// ============================================================================
// Tests
// ============================================================================

describe('Sessions API (Database Operations)', () => {
  beforeEach(() => {
    frameCounter = 0;
    createTestDatabase();
  });

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  // ==========================================================================
  // List Sessions (GET /)
  // ==========================================================================

  describe('List Sessions (GET /)', () => {
    it('should return all sessions for a user', () => {
      insertSession({ userId: 1, agentId: 1, name: 'Session A' });
      insertSession({ userId: 1, agentId: 1, name: 'Session B' });

      let sessions = listSessions(1);

      assert.equal(sessions.length, 2);
      let names = sessions.map((s) => s.name);
      assert.ok(names.includes('Session A'));
      assert.ok(names.includes('Session B'));
    });

    it('should return empty array for user with no sessions', () => {
      let sessions = listSessions(1);
      assert.deepEqual(sessions, []);
    });

    it('should include agent info (id, name, type)', () => {
      insertSession({ userId: 1, agentId: 1, name: 'Test' });

      let sessions = listSessions(1);

      assert.equal(sessions[0].agent.id, 1);
      assert.equal(sessions[0].agent.name, 'AliceAgent');
      assert.equal(sessions[0].agent.type, 'claude');
    });

    it('should include message count', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Chat' });
      insertMessageFrame(sessionId, 'Hello');
      insertMessageFrame(sessionId, 'World');
      insertMessageFrame(sessionId, 'Three');

      let sessions = listSessions(1);

      assert.equal(sessions[0].messageCount, 3);
    });

    it('should include preview from last message frame with string content', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Chat' });
      insertMessageFrame(sessionId, 'First message', 'user', '2024-01-01T00:00:01Z');
      insertMessageFrame(sessionId, 'Last message here', 'agent', '2024-01-01T00:00:02Z');

      let sessions = listSessions(1);

      assert.equal(sessions[0].preview, 'Last message here');
    });

    it('should include preview from last message frame with array content', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Chat' });
      let arrayContent = [{ type: 'text', text: 'Block content preview' }];
      insertMessageFrame(sessionId, arrayContent);

      let sessions = listSessions(1);

      assert.equal(sessions[0].preview, 'Block content preview');
    });

    it('should support search by session name', () => {
      insertSession({ userId: 1, agentId: 1, name: 'Planning meeting' });
      insertSession({ userId: 1, agentId: 1, name: 'Code review' });

      let sessions = listSessions(1, 'Planning');

      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].name, 'Planning meeting');
    });

    it('should support search by message content', () => {
      let sessionId1 = insertSession({ userId: 1, agentId: 1, name: 'Session A' });
      let sessionId2 = insertSession({ userId: 1, agentId: 1, name: 'Session B' });
      insertMessageFrame(sessionId1, 'I love bananas');
      insertMessageFrame(sessionId2, 'I love oranges');

      let sessions = listSessions(1, 'bananas');

      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].name, 'Session A');
    });

    it('should build parent-child hierarchy correctly', () => {
      let parentId = insertSession({ userId: 1, agentId: 1, name: 'Parent', updatedAt: '2024-01-01T00:00:03Z' });
      let childId = insertSession({ userId: 1, agentId: 1, name: 'Child', parentSessionId: parentId, updatedAt: '2024-01-01T00:00:02Z' });
      let otherRoot = insertSession({ userId: 1, agentId: 1, name: 'Other Root', updatedAt: '2024-01-01T00:00:01Z' });

      let sessions = listSessions(1);

      // Parent should come first (most recently updated root), child follows immediately
      assert.equal(sessions[0].name, 'Parent');
      assert.equal(sessions[0].depth, 0);
      assert.equal(sessions[1].name, 'Child');
      assert.equal(sessions[1].depth, 1);
      assert.equal(sessions[1].parentSessionId, parentId);
      assert.equal(sessions[2].name, 'Other Root');
      assert.equal(sessions[2].depth, 0);
    });

    it('should order children by updated_at DESC', () => {
      let parentId = insertSession({ userId: 1, agentId: 1, name: 'Parent', updatedAt: '2024-01-01T00:00:10Z' });
      insertSession({ userId: 1, agentId: 1, name: 'Older Child', parentSessionId: parentId, updatedAt: '2024-01-01T00:00:01Z' });
      insertSession({ userId: 1, agentId: 1, name: 'Newer Child', parentSessionId: parentId, updatedAt: '2024-01-01T00:00:05Z' });

      let sessions = listSessions(1);

      // Parent first, then newer child, then older child
      assert.equal(sessions[0].name, 'Parent');
      assert.equal(sessions[1].name, 'Newer Child');
      assert.equal(sessions[2].name, 'Older Child');
    });

    it('should only return sessions for the requesting user (isolation)', () => {
      insertSession({ userId: 1, agentId: 1, name: 'Alice Session' });
      insertSession({ userId: 2, agentId: 2, name: 'Bob Session' });

      let aliceSessions = listSessions(1);
      let bobSessions = listSessions(2);

      assert.equal(aliceSessions.length, 1);
      assert.equal(aliceSessions[0].name, 'Alice Session');
      assert.equal(bobSessions.length, 1);
      assert.equal(bobSessions[0].name, 'Bob Session');
    });
  });

  // ==========================================================================
  // Create Session (POST /)
  // ==========================================================================

  describe('Create Session (POST /)', () => {
    it('should create a session with name and agentId', () => {
      let response = createSession(1, { name: 'New Chat', agentId: 1 });

      assert.equal(response.status, 201);
      assert.equal(response.body.name, 'New Chat');
      assert.ok(response.body.id);
      assert.equal(response.body.messageCount, 0);
    });

    it('should return 400 if name is missing', () => {
      let response = createSession(1, { agentId: 1 });

      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'Name and agentId are required');
    });

    it('should return 400 if agentId is missing', () => {
      let response = createSession(1, { name: 'Chat' });

      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'Name and agentId are required');
    });

    it('should return 404 if agent does not exist', () => {
      let response = createSession(1, { name: 'Chat', agentId: 999 });

      assert.equal(response.status, 404);
      assert.equal(response.body.error, 'Agent not found');
    });

    it('should return 404 if agent belongs to a different user', () => {
      // Agent 2 belongs to Bob (user 2)
      let response = createSession(1, { name: 'Chat', agentId: 2 });

      assert.equal(response.status, 404);
      assert.equal(response.body.error, 'Agent not found');
    });

    it('should support system prompt', () => {
      let response = createSession(1, {
        name:         'Custom Chat',
        agentId:      1,
        systemPrompt: 'You are a helpful pirate.',
      });

      assert.equal(response.status, 201);
      assert.equal(response.body.systemPrompt, 'You are a helpful pirate.');

      // Verify persisted in database
      let row = db.prepare('SELECT system_prompt FROM sessions WHERE id = ?').get(response.body.id);
      assert.equal(row.system_prompt, 'You are a helpful pirate.');
    });

    it('should support status', () => {
      let response = createSession(1, {
        name:    'Archived Chat',
        agentId: 1,
        status:  'archived',
      });

      assert.equal(response.status, 201);
      assert.equal(response.body.status, 'archived');
      assert.equal(response.body.archived, true);
    });

    it('should support parent session', () => {
      let parentId = insertSession({ userId: 1, agentId: 1, name: 'Parent' });
      let response = createSession(1, {
        name:            'Child Chat',
        agentId:         1,
        parentSessionId: parentId,
      });

      assert.equal(response.status, 201);
      assert.equal(response.body.parentSessionId, parentId);

      // Verify persisted
      let row = db.prepare('SELECT parent_session_id FROM sessions WHERE id = ?').get(response.body.id);
      assert.equal(row.parent_session_id, parentId);
    });

    it('should return 404 if parent session does not exist', () => {
      let response = createSession(1, {
        name:            'Orphan',
        agentId:         1,
        parentSessionId: 999,
      });

      assert.equal(response.status, 404);
      assert.equal(response.body.error, 'Parent session not found');
    });

    it('should include agent info in response', () => {
      let response = createSession(1, { name: 'Chat', agentId: 1 });

      assert.equal(response.status, 201);
      assert.equal(response.body.agent.id, 1);
      assert.equal(response.body.agent.name, 'AliceAgent');
      assert.equal(response.body.agent.type, 'claude');
    });
  });

  // ==========================================================================
  // Get Session (GET /:id)
  // ==========================================================================

  describe('Get Session (GET /:id)', () => {
    it('should return session with agent info', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'My Chat' });

      let response = getSession(1, sessionId);

      assert.equal(response.status, 200);
      assert.equal(response.body.name, 'My Chat');
      assert.equal(response.body.agent.id, 1);
      assert.equal(response.body.agent.name, 'AliceAgent');
      assert.equal(response.body.agent.type, 'claude');
    });

    it('should return session with messages from frames', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Chat' });
      insertMessageFrame(sessionId, { role: 'user', content: 'Hello' }, 'user', '2024-01-01T00:00:01Z');
      insertMessageFrame(sessionId, { role: 'assistant', content: 'Hi back' }, 'agent', '2024-01-01T00:00:02Z');

      let response = getSession(1, sessionId);

      assert.equal(response.status, 200);
      assert.equal(response.body.messages.length, 2);
      assert.equal(response.body.messages[0].role, 'user');
      assert.equal(response.body.messages[0].content, 'Hello');
      assert.equal(response.body.messages[1].role, 'assistant');
      assert.equal(response.body.messages[1].content, 'Hi back');
    });

    it('should return messages in timestamp ASC order', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Chat' });
      insertMessageFrame(sessionId, { role: 'user', content: 'First' }, 'user', '2024-01-01T00:00:01Z');
      insertMessageFrame(sessionId, { role: 'assistant', content: 'Second' }, 'agent', '2024-01-01T00:00:02Z');
      insertMessageFrame(sessionId, { role: 'user', content: 'Third' }, 'user', '2024-01-01T00:00:03Z');

      let response = getSession(1, sessionId);
      let contents = response.body.messages.map((m) => m.content);

      assert.deepEqual(contents, ['First', 'Second', 'Third']);
    });

    it('should return 404 for non-existent session', () => {
      let response = getSession(1, 999);

      assert.equal(response.status, 404);
      assert.equal(response.body.error, 'Session not found');
    });

    it('should return 404 for session belonging to a different user', () => {
      let sessionId = insertSession({ userId: 2, agentId: 2, name: 'Bob Chat' });

      let response = getSession(1, sessionId);

      assert.equal(response.status, 404);
      assert.equal(response.body.error, 'Session not found');
    });

    it('should include cost information', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Chat' });
      db.prepare('UPDATE sessions SET input_tokens = 500, output_tokens = 200 WHERE id = ?').run(sessionId);

      let response = getSession(1, sessionId);

      assert.equal(response.body.cost.inputTokens, 500);
      assert.equal(response.body.cost.outputTokens, 200);
    });

    it('should default cost tokens to zero', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Chat' });

      let response = getSession(1, sessionId);

      assert.equal(response.body.cost.inputTokens, 0);
      assert.equal(response.body.cost.outputTokens, 0);
    });
  });

  // ==========================================================================
  // Update Session (PUT /:id)
  // ==========================================================================

  describe('Update Session (PUT /:id)', () => {
    it('should update session name', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Old Name' });

      let response = updateSession(1, sessionId, { name: 'New Name' });

      assert.equal(response.status, 200);
      assert.equal(response.body.success, true);

      let row = db.prepare('SELECT name FROM sessions WHERE id = ?').get(sessionId);
      assert.equal(row.name, 'New Name');
    });

    it('should update system prompt', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Chat' });

      let response = updateSession(1, sessionId, { systemPrompt: 'Be concise.' });

      assert.equal(response.status, 200);

      let row = db.prepare('SELECT system_prompt FROM sessions WHERE id = ?').get(sessionId);
      assert.equal(row.system_prompt, 'Be concise.');
    });

    it('should clear system prompt when set to empty string', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Chat', systemPrompt: 'Old prompt' });

      let response = updateSession(1, sessionId, { systemPrompt: '' });

      assert.equal(response.status, 200);

      let row = db.prepare('SELECT system_prompt FROM sessions WHERE id = ?').get(sessionId);
      assert.equal(row.system_prompt, null);
    });

    it('should return 400 with no fields to update', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Chat' });

      let response = updateSession(1, sessionId, {});

      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'No fields to update');
    });

    it('should return 404 for non-existent session', () => {
      let response = updateSession(1, 999, { name: 'Updated' });

      assert.equal(response.status, 404);
      assert.equal(response.body.error, 'Session not found');
    });

    it('should return 404 for session belonging to a different user', () => {
      let sessionId = insertSession({ userId: 2, agentId: 2, name: 'Bob Chat' });

      let response = updateSession(1, sessionId, { name: 'Hijacked' });

      assert.equal(response.status, 404);
      assert.equal(response.body.error, 'Session not found');
    });

    it('should update the updated_at timestamp', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Chat', updatedAt: '2020-01-01T00:00:00Z' });
      let before = db.prepare('SELECT updated_at FROM sessions WHERE id = ?').get(sessionId);

      updateSession(1, sessionId, { name: 'Renamed' });

      let after = db.prepare('SELECT updated_at FROM sessions WHERE id = ?').get(sessionId);
      assert.notEqual(before.updated_at, after.updated_at);
    });
  });

  // ==========================================================================
  // Delete Session (DELETE /:id)
  // ==========================================================================

  describe('Delete Session (DELETE /:id)', () => {
    it('should delete a session', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Doomed' });

      let response = deleteSession(1, sessionId);

      assert.equal(response.status, 200);
      assert.equal(response.body.success, true);

      let row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
      assert.equal(row, undefined);
    });

    it('should return 404 for non-existent session', () => {
      let response = deleteSession(1, 999);

      assert.equal(response.status, 404);
      assert.equal(response.body.error, 'Session not found');
    });

    it('should return 404 for session belonging to a different user', () => {
      let sessionId = insertSession({ userId: 2, agentId: 2, name: 'Bob Chat' });

      let response = deleteSession(1, sessionId);

      assert.equal(response.status, 404);
      assert.equal(response.body.error, 'Session not found');

      // Bob's session should still exist
      let row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
      assert.ok(row);
    });

    it('should cascade delete to frames', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Chat' });
      insertMessageFrame(sessionId, 'Hello');
      insertMessageFrame(sessionId, 'World');

      let framesBefore = db.prepare('SELECT COUNT(*) as count FROM frames WHERE session_id = ?').get(sessionId);
      assert.equal(framesBefore.count, 2);

      deleteSession(1, sessionId);

      let framesAfter = db.prepare('SELECT COUNT(*) as count FROM frames WHERE session_id = ?').get(sessionId);
      assert.equal(framesAfter.count, 0);
    });
  });

  // ==========================================================================
  // Archive / Unarchive
  // ==========================================================================

  describe('Archive / Unarchive', () => {
    it('should archive a session (sets status to archived)', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Active Chat' });

      let response = archiveSession(1, sessionId);

      assert.equal(response.status, 200);
      assert.equal(response.body.status, 'archived');
      assert.equal(response.body.archived, true);

      let row = db.prepare('SELECT status FROM sessions WHERE id = ?').get(sessionId);
      assert.equal(row.status, 'archived');
    });

    it('should unarchive a session (clears status)', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Archived Chat', status: 'archived' });

      let response = unarchiveSession(1, sessionId);

      assert.equal(response.status, 200);
      assert.equal(response.body.status, null);
      assert.equal(response.body.archived, false);

      let row = db.prepare('SELECT status FROM sessions WHERE id = ?').get(sessionId);
      assert.equal(row.status, null);
    });

    it('should return 404 when archiving a non-existent session', () => {
      let response = archiveSession(1, 999);

      assert.equal(response.status, 404);
      assert.equal(response.body.error, 'Session not found');
    });

    it('should return 404 when unarchiving a non-existent session', () => {
      let response = unarchiveSession(1, 999);

      assert.equal(response.status, 404);
      assert.equal(response.body.error, 'Session not found');
    });

    it('should return 404 when archiving a session belonging to a different user', () => {
      let sessionId = insertSession({ userId: 2, agentId: 2, name: 'Bob Chat' });

      let response = archiveSession(1, sessionId);

      assert.equal(response.status, 404);
    });
  });

  // ==========================================================================
  // Status Update (PUT /:id/status)
  // ==========================================================================

  describe('Status Update (PUT /:id/status)', () => {
    it('should set status', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Chat' });

      let response = updateSessionStatus(1, sessionId, 'processing');

      assert.equal(response.status, 200);
      assert.equal(response.body.status, 'processing');

      let row = db.prepare('SELECT status FROM sessions WHERE id = ?').get(sessionId);
      assert.equal(row.status, 'processing');
    });

    it('should clear status with null', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Chat', status: 'processing' });

      let response = updateSessionStatus(1, sessionId, null);

      assert.equal(response.status, 200);
      assert.equal(response.body.status, null);

      let row = db.prepare('SELECT status FROM sessions WHERE id = ?').get(sessionId);
      assert.equal(row.status, null);
    });

    it('should clear status with empty string', () => {
      let sessionId = insertSession({ userId: 1, agentId: 1, name: 'Chat', status: 'active' });

      let response = updateSessionStatus(1, sessionId, '');

      assert.equal(response.status, 200);
      assert.equal(response.body.status, null);

      let row = db.prepare('SELECT status FROM sessions WHERE id = ?').get(sessionId);
      assert.equal(row.status, null);
    });

    it('should return 404 for non-existent session', () => {
      let response = updateSessionStatus(1, 999, 'active');

      assert.equal(response.status, 404);
      assert.equal(response.body.error, 'Session not found');
    });

    it('should return 404 for session belonging to a different user', () => {
      let sessionId = insertSession({ userId: 2, agentId: 2, name: 'Bob Chat' });

      let response = updateSessionStatus(1, sessionId, 'active');

      assert.equal(response.status, 404);
    });
  });
});
