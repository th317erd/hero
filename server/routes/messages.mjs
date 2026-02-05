'use strict';

import { randomUUID } from 'crypto';
import { Router } from 'express';
import { getDatabase } from '../database.mjs';
import { decryptWithKey } from '../encryption.mjs';
import { requireAuth, getDataKey } from '../middleware/auth.mjs';
import { createAgent, getAgentTypes } from '../lib/agents/index.mjs';
import { getSystemProcess, isSystemProcess, injectProcesses } from '../lib/processes/index.mjs';
import { detectOperations, formatOperationFeedback, executeOperations } from '../lib/operations/index.mjs';
import { buildContext } from '../lib/pipeline/context.mjs';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/sessions/:sessionId/messages
 * Get all messages for a session.
 */
router.get('/:sessionId/messages', (req, res) => {
  let db      = getDatabase();
  let session = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(req.params.sessionId, req.user.id);

  if (!session)
    return res.status(404).json({ error: 'Session not found' });

  let messages = db.prepare(`
    SELECT id, role, content, created_at
    FROM messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(req.params.sessionId);

  return res.json({
    messages: messages.map((m) => ({
      id:        m.id,
      role:      m.role,
      content:   JSON.parse(m.content),
      createdAt: m.created_at,
    })),
  });
});

/**
 * POST /api/sessions/:sessionId/messages
 * Send a message and get the agent's response.
 */
router.post('/:sessionId/messages', async (req, res) => {
  let { content } = req.body;

  if (!content || typeof content !== 'string')
    return res.status(400).json({ error: 'Message content required' });

  let db = getDatabase();

  // Get session with agent info
  let session = db.prepare(`
    SELECT
      s.id,
      s.system_prompt,
      a.id as agent_id,
      a.type as agent_type,
      a.api_url as agent_api_url,
      a.encrypted_api_key,
      a.encrypted_config,
      a.default_processes
    FROM sessions s
    JOIN agents a ON s.agent_id = a.id
    WHERE s.id = ? AND s.user_id = ?
  `).get(req.params.sessionId, req.user.id);

  if (!session)
    return res.status(404).json({ error: 'Session not found' });

  try {
    let dataKey = getDataKey(req);

    // Decrypt agent credentials
    let apiKey      = session.encrypted_api_key ? decryptWithKey(session.encrypted_api_key, dataKey) : null;
    let agentConfig = session.encrypted_config ? JSON.parse(decryptWithKey(session.encrypted_config, dataKey)) : {};

    // Build process map for injection
    let defaultProcesses = JSON.parse(session.default_processes || '[]');
    let processMap       = new Map();

    // Load system processes
    for (let processName of defaultProcesses) {
      if (isSystemProcess(processName)) {
        let processContent = getSystemProcess(processName);
        if (processContent)
          processMap.set(processName, processContent);
      }
    }

    // Load user processes
    let userProcessNames = defaultProcesses.filter((n) => !isSystemProcess(n));
    if (userProcessNames.length > 0) {
      let placeholders  = userProcessNames.map(() => '?').join(',');
      let userProcesses = db.prepare(`
        SELECT name, encrypted_content
        FROM processes
        WHERE user_id = ? AND name IN (${placeholders})
      `).all(req.user.id, ...userProcessNames);

      for (let p of userProcesses) {
        let decryptedContent = decryptWithKey(p.encrypted_content, dataKey);
        processMap.set(p.name, decryptedContent);
      }
    }

    // Inject processes into user message content
    let processedContent = injectProcesses(content, processMap);

    // Get existing messages
    let existingMessages = db.prepare(`
      SELECT role, content
      FROM messages
      WHERE session_id = ?
      ORDER BY created_at ASC
    `).all(req.params.sessionId);

    let messages = existingMessages.map((m) => ({
      role:    m.role,
      content: JSON.parse(m.content),
    }));

    // Store user message (original, without process injection)
    db.prepare(`
      INSERT INTO messages (session_id, role, content)
      VALUES (?, 'user', ?)
    `).run(req.params.sessionId, JSON.stringify(content));

    // Update session timestamp
    db.prepare('UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.sessionId);

    // Add user message to history (with processes injected for AI)
    messages.push({ role: 'user', content: processedContent });

    // Create agent and send message
    let agent = createAgent(session.agent_type, {
      apiKey:  apiKey,
      apiUrl:  session.agent_api_url,
      system:  session.system_prompt,
      ...agentConfig,
    });

    let response = await agent.sendMessage(messages);

    // Operation execution loop - detect and execute operations, feed results back
    let maxIterations = 10; // Prevent infinite loops
    let iterations    = 0;

    while (iterations < maxIterations) {
      iterations++;

      // Check if response is an operation block
      let operationBlock = detectOperations(response.content);

      if (!operationBlock)
        break; // Not an operation block, exit loop

      // Store the operation request from assistant
      db.prepare(`
        INSERT INTO messages (session_id, role, content)
        VALUES (?, 'assistant', ?)
      `).run(req.params.sessionId, JSON.stringify(response.content));

      // Build rich context for operation execution
      let messageId = randomUUID();
      let context   = buildContext({
        req,
        sessionId: req.params.sessionId,
        dataKey:   dataKey,
        messageId: messageId,
      });

      let results = await executeOperations(operationBlock, context);

      // Format results as feedback for AI
      let feedback = formatOperationFeedback(results);

      // Store feedback as system/user message
      db.prepare(`
        INSERT INTO messages (session_id, role, content)
        VALUES (?, 'user', ?)
      `).run(req.params.sessionId, JSON.stringify(feedback));

      // Add to message history and continue conversation
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: feedback });

      // Get next response from agent
      response = await agent.sendMessage(messages);
    }

    // Store final assistant response
    db.prepare(`
      INSERT INTO messages (session_id, role, content)
      VALUES (?, 'assistant', ?)
    `).run(req.params.sessionId, JSON.stringify(response.content));

    // Store any tool result messages that occurred during the agentic loop
    if (response.toolMessages && response.toolMessages.length > 0) {
      let insertStmt = db.prepare('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)');

      for (let msg of response.toolMessages)
        insertStmt.run(req.params.sessionId, msg.role, JSON.stringify(msg.content));
    }

    return res.json({
      content:      response.content,
      toolCalls:    response.toolCalls || [],
      stopReason:   response.stopReason,
      operationLog: iterations > 1 ? `Executed ${iterations - 1} operation cycles` : null,
    });
  } catch (error) {
    console.error('Message error:', error);
    return res.status(500).json({ error: 'Failed to process message' });
  }
});

/**
 * DELETE /api/sessions/:sessionId/messages
 * Clear all messages in a session.
 */
router.delete('/:sessionId/messages', (req, res) => {
  let db      = getDatabase();
  let session = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(req.params.sessionId, req.user.id);

  if (!session)
    return res.status(404).json({ error: 'Session not found' });

  db.prepare('DELETE FROM messages WHERE session_id = ?').run(req.params.sessionId);
  db.prepare('UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.sessionId);

  return res.json({ success: true });
});

export default router;
