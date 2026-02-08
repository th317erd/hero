'use strict';

// ============================================================================
// Non-Streaming Messages Route (Frame-Based)
// ============================================================================
// Provides non-streaming message handling. For most use cases, prefer the
// streaming endpoint at /messages/stream.

import { randomUUID } from 'crypto';
import { Router } from 'express';
import { getDatabase } from '../database.mjs';
import { decryptWithKey } from '../encryption.mjs';
import { requireAuth, getDataKey } from '../middleware/auth.mjs';
import { createAgent } from '../lib/agents/index.mjs';
import { getSystemProcess, isSystemProcess, injectProcesses } from '../lib/processes/index.mjs';
import { detectInteractions, executeInteractions, formatInteractionFeedback } from '../lib/interactions/index.mjs';
import { buildContext } from '../lib/pipeline/context.mjs';
import { processMarkup, hasExecutableElements } from '../lib/markup/index.mjs';
import { getStartupAbilities } from '../lib/abilities/registry.mjs';
import { loadUserAbilities } from '../lib/abilities/loaders/user.mjs';
import { loadFramesForContext } from '../lib/frames/context.mjs';
import {
  createUserMessageFrame,
  createAgentMessageFrame,
  createSystemMessageFrame,
} from '../lib/frames/broadcast.mjs';

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

  // Get message frames and convert to legacy format
  let frames = db.prepare(`
    SELECT id, type, author_type, payload, timestamp
    FROM frames
    WHERE session_id = ? AND type = 'message'
    ORDER BY timestamp ASC
  `).all(req.params.sessionId);

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
    };
  });

  return res.json({ messages });
});

/**
 * POST /api/sessions/:sessionId/messages
 * Send a message and get the agent's response (non-streaming).
 */
router.post('/:sessionId/messages', async (req, res) => {
  let { content } = req.body;

  if (!content || typeof content !== 'string')
    return res.status(400).json({ error: 'Message content required' });

  let db = getDatabase();
  let sessionId = parseInt(req.params.sessionId, 10);

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
  `).get(sessionId, req.user.id);

  if (!session)
    return res.status(404).json({ error: 'Session not found' });

  try {
    let dataKey = getDataKey(req);

    // Load user abilities
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

    // Check if this is the first message
    let frameCount = db.prepare(`
      SELECT COUNT(*) as count FROM frames
      WHERE session_id = ? AND type = 'message'
    `).get(sessionId)?.count || 0;

    let messages = [];

    // If this is the first message, inject startup abilities
    if (frameCount === 0) {
      let startupAbilities = getStartupAbilities();

      if (startupAbilities.length > 0) {
        let startupContent = startupAbilities
          .filter((a) => a.type === 'process' && a.content)
          .map((a) => a.content)
          .join('\n\n---\n\n');

        if (startupContent) {
          let onstartUserContent = `[System Initialization]\n\n${startupContent}`;

          // Store startup messages as hidden frames
          createSystemMessageFrame({
            sessionId: sessionId,
            userId:    req.user.id,
            content:   onstartUserContent,
            hidden:    true,
          });

          messages.push({ role: 'user', content: onstartUserContent });

          // Also add a placeholder assistant acknowledgment
          let ackContent = 'Understood. I\'ve processed the initialization instructions. Ready to assist.';
          createAgentMessageFrame({
            sessionId: sessionId,
            userId:    req.user.id,
            agentId:   session.agent_id,
            content:   ackContent,
            hidden:    true,
          });

          messages.push({ role: 'assistant', content: ackContent });
        }
      }
    } else {
      // Load existing messages from frames
      messages = loadFramesForContext(sessionId, { maxRecentFrames: 20 });
    }

    // Store user message as frame
    createUserMessageFrame({
      sessionId: sessionId,
      userId:    req.user.id,
      content:   content,
      hidden:    false,
    });

    // Update session timestamp
    db.prepare('UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(sessionId);

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

    // Interaction execution loop
    let maxIterations = 10;
    let iterations    = 0;

    while (iterations < maxIterations) {
      iterations++;

      let interactionBlock = detectInteractions(response.content);

      if (!interactionBlock)
        break;

      // Store the interaction request as hidden frame
      createAgentMessageFrame({
        sessionId: sessionId,
        userId:    req.user.id,
        agentId:   session.agent_id,
        content:   response.content,
        hidden:    true,
      });

      // Build context and execute interactions
      let interactionContext = {
        sessionId: sessionId,
        userId:    req.user.id,
        dataKey:   dataKey,
      };

      let results = await executeInteractions(interactionBlock, interactionContext);

      // Format results as feedback
      let feedback = formatInteractionFeedback(results);

      // Store feedback as hidden frame
      createSystemMessageFrame({
        sessionId: sessionId,
        userId:    req.user.id,
        content:   feedback,
        hidden:    true,
      });

      // Add to message history and continue
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: feedback });

      // Get next response
      response = await agent.sendMessage(messages);
    }

    // Process HML markup elements
    let finalContent = response.content;

    if (typeof finalContent === 'string' && hasExecutableElements(finalContent)) {
      let hmlContext = buildContext({
        req,
        sessionId: sessionId,
        dataKey:   dataKey,
        messageId: randomUUID(),
      });

      let markupResult = await processMarkup(finalContent, hmlContext);

      if (markupResult.modified)
        finalContent = markupResult.text;
    }

    // Store final assistant response as frame
    createAgentMessageFrame({
      sessionId: sessionId,
      userId:    req.user.id,
      agentId:   session.agent_id,
      content:   finalContent,
      hidden:    false,
    });

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
 * Clear all frames in a session.
 */
router.delete('/:sessionId/messages', (req, res) => {
  let db      = getDatabase();
  let session = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(req.params.sessionId, req.user.id);

  if (!session)
    return res.status(404).json({ error: 'Session not found' });

  db.prepare('DELETE FROM frames WHERE session_id = ?').run(req.params.sessionId);
  db.prepare('UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.sessionId);

  return res.json({ success: true });
});

export default router;
