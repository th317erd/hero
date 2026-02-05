'use strict';

import { randomUUID } from 'crypto';
import { Router } from 'express';
import { getDatabase } from '../database.mjs';
import { decryptWithKey } from '../encryption.mjs';
import { requireAuth, getDataKey } from '../middleware/auth.mjs';
import { createAgent, getAgentTypes } from '../lib/agents/index.mjs';
import { getSystemProcess, isSystemProcess, injectProcesses } from '../lib/processes/index.mjs';
import { detectInteractions, executeInteractions, formatInteractionFeedback } from '../lib/interactions/index.mjs';
import { buildContext } from '../lib/pipeline/context.mjs';
import { processMarkup, hasExecutableElements } from '../lib/markup/index.mjs';
import { getStartupAbilities } from '../lib/abilities/registry.mjs';
import { loadUserAbilities } from '../lib/abilities/loaders/user.mjs';

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
    SELECT id, role, content, hidden, type, created_at
    FROM messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(req.params.sessionId);

  return res.json({
    messages: messages.map((m) => ({
      id:        m.id,
      role:      m.role,
      content:   JSON.parse(m.content),
      hidden:    !!m.hidden,
      type:      m.type || 'message',
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

    // Load user abilities (ensures user's _onstart_* abilities are available)
    // This also loads any plugin abilities the user has configured
    loadUserAbilities(req.user.id, dataKey);

    // Decrypt agent credentials
    let apiKey      = (session.encrypted_api_key) ? decryptWithKey(session.encrypted_api_key, dataKey) : null;
    let agentConfig = (session.encrypted_config) ? JSON.parse(decryptWithKey(session.encrypted_config, dataKey)) : {};

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

    // If this is the first message, inject startup abilities
    if (existingMessages.length === 0) {
      let startupAbilities = getStartupAbilities();

      if (startupAbilities.length > 0) {
        // Combine all startup ability contents into a single setup message
        let startupContent = startupAbilities
          .filter((a) => a.type === 'process' && a.content)
          .map((a) => a.content)
          .join('\n\n---\n\n');

        if (startupContent) {
          // Store startup messages as hidden (hidden=1) with type='system' so they're not displayed in UI
          db.prepare(`
            INSERT INTO messages (session_id, role, content, hidden, type)
            VALUES (?, 'user', ?, 1, 'system')
          `).run(req.params.sessionId, JSON.stringify(`[System Initialization]\n\n${startupContent}`));

          // Add to messages array for the AI
          messages.push({
            role:    'user',
            content: `[System Initialization]\n\n${startupContent}`,
          });

          // Also add a placeholder assistant acknowledgment to set up the conversation flow
          let ackContent = 'Understood. I\'ve processed the initialization instructions. Ready to assist.';
          db.prepare(`
            INSERT INTO messages (session_id, role, content, hidden, type)
            VALUES (?, 'assistant', ?, 1, 'system')
          `).run(req.params.sessionId, JSON.stringify(ackContent));

          messages.push({
            role:    'assistant',
            content: ackContent,
          });

          console.log(`Injected ${startupAbilities.length} startup abilities for session ${req.params.sessionId}`);
        }
      }
    }

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

    // Interaction execution loop - detect and execute interactions, feed results back
    let maxIterations = 10; // Prevent infinite loops
    let iterations    = 0;

    while (iterations < maxIterations) {
      iterations++;

      // Check if response is an interaction block
      let interactionBlock = detectInteractions(response.content);

      if (!interactionBlock)
        break; // Not an interaction block, exit loop

      // Store the interaction request from assistant (hidden interaction message)
      db.prepare(`
        INSERT INTO messages (session_id, role, content, hidden, type)
        VALUES (?, 'assistant', ?, 1, 'interaction')
      `).run(req.params.sessionId, JSON.stringify(response.content));

      // Build context for interaction execution
      let interactionContext = {
        sessionId: req.params.sessionId,
        userId:    req.user.id,
        dataKey:   dataKey,
      };

      let results = await executeInteractions(interactionBlock, interactionContext);

      // Format results as feedback for AI
      let feedback = formatInteractionFeedback(results);

      // Store feedback as hidden feedback message
      db.prepare(`
        INSERT INTO messages (session_id, role, content, hidden, type)
        VALUES (?, 'user', ?, 1, 'feedback')
      `).run(req.params.sessionId, JSON.stringify(feedback));

      // Add to message history and continue conversation
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: feedback });

      // Get next response from agent
      response = await agent.sendMessage(messages);
    }

    // Process HML markup elements in the response
    let finalContent = response.content;

    if (typeof finalContent === 'string' && hasExecutableElements(finalContent)) {
      // Build context for HML execution
      let hmlContext = buildContext({
        req,
        sessionId: req.params.sessionId,
        dataKey:   dataKey,
        messageId: randomUUID(),
      });

      let markupResult = await processMarkup(finalContent, hmlContext);

      if (markupResult.modified)
        finalContent = markupResult.text;
    }

    // Store final assistant response
    db.prepare(`
      INSERT INTO messages (session_id, role, content)
      VALUES (?, 'assistant', ?)
    `).run(req.params.sessionId, JSON.stringify(finalContent));

    // Store any tool result messages that occurred during the agentic loop
    if (response.toolMessages && response.toolMessages.length > 0) {
      let insertStmt = db.prepare('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)');

      for (let msg of response.toolMessages)
        insertStmt.run(req.params.sessionId, msg.role, JSON.stringify(msg.content));
    }

    return res.json({
      content:        finalContent,
      toolCalls:      response.toolCalls || [],
      stopReason:     response.stopReason,
      interactionLog: (iterations > 1) ? `Executed ${iterations - 1} interaction cycles` : null,
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
