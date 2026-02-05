'use strict';

// ============================================================================
// Streaming Messages Route
// ============================================================================
// Provides real-time streaming of agent responses with progressive HML parsing.
// Uses Server-Sent Events (SSE) for efficient one-way streaming.

import { randomUUID } from 'crypto';
import { Router } from 'express';
import { getDatabase } from '../database.mjs';
import { decryptWithKey } from '../encryption.mjs';
import { requireAuth, getDataKey } from '../middleware/auth.mjs';
import { createAgent } from '../lib/agents/index.mjs';
import { getSystemProcess, isSystemProcess, injectProcesses } from '../lib/processes/index.mjs';
import { buildContext } from '../lib/pipeline/context.mjs';
import { createStreamParser } from '../lib/markup/stream-parser.mjs';
import { executePipeline } from '../lib/pipeline/index.mjs';
import { getStartupAbilities } from '../lib/abilities/registry.mjs';
import { loadUserAbilities } from '../lib/abilities/loaders/user.mjs';
import { broadcastToUser } from '../lib/websocket.mjs';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * POST /api/sessions/:sessionId/messages/stream
 * Send a message and stream the agent's response via SSE.
 *
 * Events emitted:
 * - message_start: Stream beginning
 * - text: Plain text chunk
 * - element_start: HML element opening tag detected
 * - element_update: HML element content accumulating
 * - element_complete: HML element closing tag found
 * - element_result: Executable element finished executing
 * - message_complete: Full response received
 * - error: Error occurred
 */
router.post('/:sessionId/messages/stream', async (req, res) => {
  let { content } = req.body;

  if (!content || typeof content !== 'string')
    return res.status(400).json({ error: 'Message content required' });

  let db = getDatabase();

  // Get session with agent info
  let session = db.prepare(`
    SELECT
      s.id,
      s.name as session_name,
      s.system_prompt,
      a.id as agent_id,
      a.name as agent_name,
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

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Helper to send SSE events
  function sendEvent(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    // Also broadcast to WebSocket for other connected clients
    broadcastToUser(req.user.id, {
      type: `stream_${event}`,
      sessionId: req.params.sessionId,
      ...data,
    });
  }

  // Handle client disconnect
  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

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

    // Inject startup abilities if first message
    if (existingMessages.length === 0) {
      let startupAbilities = getStartupAbilities();

      if (startupAbilities.length > 0) {
        let startupContent = startupAbilities
          .filter((a) => a.type === 'process' && a.content)
          .map((a) => a.content)
          .join('\n\n---\n\n');

        if (startupContent) {
          // Store startup messages as hidden (hidden=1) so they're not displayed in UI
          db.prepare(`
            INSERT INTO messages (session_id, role, content, hidden)
            VALUES (?, 'user', ?, 1)
          `).run(req.params.sessionId, JSON.stringify(`[System Initialization]\n\n${startupContent}`));

          messages.push({
            role:    'user',
            content: `[System Initialization]\n\n${startupContent}`,
          });

          let ackContent = 'Understood. I\'ve processed the initialization instructions. Ready to assist.';
          db.prepare(`
            INSERT INTO messages (session_id, role, content, hidden)
            VALUES (?, 'assistant', ?, 1)
          `).run(req.params.sessionId, JSON.stringify(ackContent));

          messages.push({
            role:    'assistant',
            content: ackContent,
          });
        }
      }
    }

    // Store user message
    let userMessageId = randomUUID();
    db.prepare(`
      INSERT INTO messages (session_id, role, content)
      VALUES (?, 'user', ?)
    `).run(req.params.sessionId, JSON.stringify(content));

    db.prepare('UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.sessionId);

    messages.push({ role: 'user', content: processedContent });

    // Create agent
    let agent = createAgent(session.agent_type, {
      apiKey:  apiKey,
      apiUrl:  session.agent_api_url,
      system:  session.system_prompt,
      ...agentConfig,
    });

    // Send stream start event
    let messageId = randomUUID();
    sendEvent('message_start', {
      messageId,
      sessionId: req.params.sessionId,
      agentName: session.agent_name,
    });

    // Create streaming HML parser
    let parser = createStreamParser();
    let fullContent = '';
    let executedElements = [];

    // Set up parser event handlers
    parser.on('text', (data) => {
      if (!aborted)
        sendEvent('text', { messageId, ...data });
    });

    parser.on('element_start', (data) => {
      if (!aborted)
        sendEvent('element_start', { messageId, ...data });
    });

    parser.on('element_update', (data) => {
      if (!aborted)
        sendEvent('element_update', { messageId, ...data });
    });

    parser.on('element_complete', async (data) => {
      if (aborted) return;

      sendEvent('element_complete', { messageId, ...data });

      // Execute if executable
      if (data.executable) {
        try {
          let context = buildContext({
            req,
            sessionId: req.params.sessionId,
            dataKey:   dataKey,
            messageId: messageId,
          });

          // Convert element to assertion format
          let assertion = elementToAssertion(data);

          if (assertion) {
            sendEvent('element_executing', {
              messageId,
              id: data.id,
              type: data.type,
            });

            let result = await executePipeline([assertion], context);

            sendEvent('element_result', {
              messageId,
              id: data.id,
              type: data.type,
              result: result[0] || null,
            });

            executedElements.push({
              element: data,
              result: result[0] || null,
            });
          }
        } catch (error) {
          sendEvent('element_error', {
            messageId,
            id: data.id,
            type: data.type,
            error: error.message,
          });
        }
      }
    });

    parser.on('element_error', (data) => {
      if (!aborted)
        sendEvent('element_error', { messageId, ...data });
    });

    // Stream from agent
    try {
      for await (let chunk of agent.sendMessageStream(messages, { signal: req.signal })) {
        if (aborted) break;

        if (chunk.type === 'text') {
          fullContent += chunk.text;
          parser.write(chunk.text);
        } else if (chunk.type === 'tool_use_start') {
          sendEvent('tool_use_start', { messageId, ...chunk });
        } else if (chunk.type === 'tool_use_input') {
          sendEvent('tool_use_input', { messageId, ...chunk });
        } else if (chunk.type === 'tool_result') {
          sendEvent('tool_result', { messageId, ...chunk });
        } else if (chunk.type === 'done') {
          // End the parser
          parser.end();
        }
      }
    } catch (streamError) {
      console.error('Stream error from agent:', streamError);
      if (!aborted) {
        sendEvent('error', {
          messageId,
          error: streamError.message,
        });
      }
    }

    // Always end the parser (handles any remaining buffered content)
    parser.end();

    // Store final assistant response if we have content
    if (!aborted && fullContent) {
      db.prepare(`
        INSERT INTO messages (session_id, role, content)
        VALUES (?, 'assistant', ?)
      `).run(req.params.sessionId, JSON.stringify(fullContent));
    }

    // Always send message_complete so frontend can finalize
    if (!aborted) {
      sendEvent('message_complete', {
        messageId,
        content: fullContent || '',
        executedElements: executedElements.length,
      });
    }

    // End SSE stream
    res.end();
  } catch (error) {
    console.error('Stream error:', error);
    sendEvent('error', { error: error.message });
    res.end();
  }
});

/**
 * Convert HML element to assertion format for pipeline execution.
 */
function elementToAssertion(element) {
  switch (element.type) {
    case 'websearch':
      return {
        id:        element.id,
        assertion: 'command',
        name:      'system_web_search',
        message:   element.content,
        ...element.attributes,
      };

    case 'bash':
      return {
        id:        element.id,
        assertion: 'command',
        name:      'bash',
        message:   element.content,
        ...element.attributes,
      };

    case 'ask':
      return {
        id:        element.id,
        assertion: 'question',
        name:      'ask',
        message:   element.content,
        mode:      (element.attributes.timeout) ? 'timeout' : 'demand',
        timeout:   (element.attributes.timeout) ? parseInt(element.attributes.timeout, 10) * 1000 : undefined,
        default:   element.attributes.default,
        options:   element.attributes.options?.split(',').map((s) => s.trim()),
      };

    default:
      return null;
  }
}

export default router;
