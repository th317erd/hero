'use strict';

// ============================================================================
// Streaming Messages Route
// ============================================================================
// Provides real-time streaming of agent responses with progressive HML parsing.
// Uses Server-Sent Events (SSE) for efficient one-way streaming.
//
// First-message flow:
// 1. User sends first message -> server detects empty session
// 2. Server loads onstart abilities and sends to agent (non-streaming)
// 3. Server waits for agent acknowledgment
// 4. Server stores onstart + ack as hidden messages, broadcasts via WebSocket
// 5. Server proceeds with user's actual message via streaming

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
import { checkConditionalAbilities, formatConditionalInstructions } from '../lib/abilities/index.mjs';
import { broadcastToUser } from '../lib/websocket.mjs';
import { detectInteractions, executeInteractions, formatInteractionFeedback, searchWeb, getRegisteredFunctionClass } from '../lib/interactions/index.mjs';
import { checkCompaction, loadMessagesWithSnapshot } from '../lib/compaction.mjs';

/**
 * Get the banner config for a function by name.
 * Returns null if the function doesn't have a banner config.
 *
 * @param {string} functionName - The function name (targetProperty)
 * @returns {Object|null} Banner config or null
 */
function getFunctionBannerConfig(functionName) {
  let FunctionClass = getRegisteredFunctionClass(functionName);
  if (!FunctionClass) return null;

  try {
    let reg = FunctionClass.register();
    return reg.banner || null;
  } catch {
    return null;
  }
}

/**
 * Convert raw API error messages to user-friendly messages.
 */
function getFriendlyErrorMessage(rawMessage) {
  if (!rawMessage) return 'An unexpected error occurred. Please try again.';

  // Rate limit errors
  if (rawMessage.includes('429') || rawMessage.includes('rate_limit')) {
    return 'The AI service is currently busy. Please wait a moment and try again.';
  }

  // Authentication errors
  if (rawMessage.includes('401') || rawMessage.includes('authentication') || rawMessage.includes('invalid_api_key')) {
    return 'There was an authentication issue with the AI service. Please check your API key.';
  }

  // Overloaded errors
  if (rawMessage.includes('overloaded') || rawMessage.includes('529')) {
    return 'The AI service is temporarily overloaded. Please try again in a few moments.';
  }

  // Timeout errors
  if (rawMessage.includes('timeout') || rawMessage.includes('ETIMEDOUT')) {
    return 'The request timed out. Please try again.';
  }

  // Network errors
  if (rawMessage.includes('ECONNREFUSED') || rawMessage.includes('network')) {
    return 'Unable to connect to the AI service. Please check your connection.';
  }

  // Generic - don't expose raw JSON/technical details
  if (rawMessage.includes('{') || rawMessage.length > 200) {
    return 'An error occurred while processing your request. Please try again.';
  }

  return rawMessage;
}

const router = Router();

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

function debug(...args) {
  if (DEBUG)
    console.log('[Stream]', ...args);
}

/**
 * Strip <interaction> tags and their content from text.
 * Returns the cleaned text with tags removed and duplicates removed.
 *
 * @param {string} text - Text potentially containing <interaction> tags
 * @returns {string} Text with interaction tags removed
 */
function stripInteractionTags(text) {
  if (!text) return text;

  // Match <interaction>...</interaction> including content
  // Uses non-greedy match and handles multiline
  let result = text.replace(/<interaction>[\s\S]*?<\/interaction>/g, '');

  // Clean up extra whitespace left behind
  result = result.replace(/\n{3,}/g, '\n\n').trim();

  // Deduplicate paragraphs (Claude sometimes repeats text before/after interaction)
  result = deduplicateParagraphs(result);

  return result;
}

/**
 * Check if content is ONLY interaction tags (no visible text).
 * Used to mark such messages as hidden.
 *
 * @param {string} text - Text to check
 * @returns {boolean} True if content is only interaction tags
 */
function isInteractionOnly(text) {
  if (!text) return true;

  let stripped = stripInteractionTags(text);
  return stripped.trim().length === 0;
}

/**
 * Deduplicate consecutive identical paragraphs.
 * Claude sometimes repeats text before and after interaction tags.
 *
 * @param {string} text - Text to deduplicate
 * @returns {string} Text with duplicate paragraphs removed
 */
function deduplicateParagraphs(text) {
  if (!text) return text;

  let paragraphs = text.split(/\n\n+/);
  let seen       = new Set();
  let result     = [];

  for (let para of paragraphs) {
    let trimmed = para.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(para);
    }
  }

  return result.join('\n\n');
}

// All routes require authentication
router.use(requireAuth);

/**
 * Store a message in the database and broadcast to WebSocket.
 *
 * @param {object} db - Database instance
 * @param {number} sessionId - Session ID
 * @param {number} userId - User ID
 * @param {string} role - Message role ('user' or 'assistant')
 * @param {string} content - Message content
 * @param {object} options - Additional options
 * @returns {object} The stored message record
 */
function storeAndBroadcastMessage(db, sessionId, userId, role, content, options = {}) {
  let { hidden = 0, type = 'message', skipBroadcast = false } = options;

  let result = db.prepare(`
    INSERT INTO messages (session_id, role, content, hidden, type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(sessionId, role, JSON.stringify(content), hidden, type);

  let messageId = result.lastInsertRowid;

  // Get the full message record
  let message = db.prepare(`
    SELECT id, session_id, role, content, hidden, type, created_at, updated_at
    FROM messages WHERE id = ?
  `).get(messageId);

  // Broadcast to WebSocket so clients get the message in real-time
  // Skip for streamed messages - SSE message_complete handles those
  if (!skipBroadcast) {
    broadcastToUser(userId, {
      type:      'new_message',
      sessionId: sessionId,
      message:   {
        id:        message.id,
        sessionId: message.session_id,
        role:      message.role,
        content:   JSON.parse(message.content),
        hidden:    message.hidden === 1,
        type:      message.type,
        createdAt: message.created_at,
        updatedAt: message.updated_at,
      },
    });
  }

  debug('Message stored and broadcast', { id: messageId, role, hidden, type, skipBroadcast });

  return message;
}

/**
 * Process onstart abilities for a new session.
 * Makes a non-streaming call to the agent and returns the acknowledgment.
 *
 * @param {object} agent - Agent instance
 * @param {string} startupContent - The startup abilities content
 * @returns {Promise<string>} The agent's acknowledgment response
 */
async function processOnstartAbilities(agent, startupContent) {
  debug('Processing onstart abilities', { contentLength: startupContent.length });

  let messages = [
    { role: 'user', content: `[System Initialization]\n\n${startupContent}` },
  ];

  try {
    let response = await agent.sendMessage(messages, {});

    // Extract text content from response
    let ackContent = '';

    if (typeof response.content === 'string') {
      ackContent = response.content;
    } else if (Array.isArray(response.content)) {
      ackContent = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
    }

    debug('Onstart acknowledgment received', { length: ackContent.length });

    return ackContent || 'Understood. Ready to assist.';
  } catch (error) {
    debug('Onstart processing error:', error.message);
    throw error;
  }
}

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
  debug('Stream request received', { sessionId: req.params.sessionId, userId: req.user?.id });

  let { content } = req.body;

  if (!content || typeof content !== 'string') {
    debug('Invalid content:', { content });
    return res.status(400).json({ error: 'Message content required' });
  }

  debug('Content received:', { length: content.length, preview: content.slice(0, 100) });

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

  if (!session) {
    debug('Session not found');
    return res.status(404).json({ error: 'Session not found' });
  }

  debug('Session found', { id: session.id, agentType: session.agent_type, agentName: session.agent_name });

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  // Note: Don't set Transfer-Encoding manually - Node.js handles chunked encoding automatically

  // Disable all timeouts to prevent premature connection closure for SSE
  req.setTimeout(0);
  res.setTimeout(0);
  if (req.socket)
    req.socket.setTimeout(0);

  // Disable Nagle's algorithm for immediate sending
  if (res.socket) {
    res.socket.setNoDelay(true);
    res.socket.setKeepAlive(true, 30000);
    res.socket.setTimeout(0);
  }

  // Add error handlers to detect issues
  res.on('error', (err) => {
    debug('Response error:', err.message);
  });

  if (res.socket) {
    res.socket.on('error', (err) => {
      debug('Socket error:', err.message);
    });
    res.socket.on('end', () => {
      debug('Socket end event');
    });
    res.socket.on('timeout', () => {
      debug('Socket timeout');
    });
  }

  res.flushHeaders();

  // Send initial comment to establish connection
  res.write(':ok\n\n');
  if (res.flush)
    res.flush();

  debug('SSE headers sent and flushed');

  // Wrap res.end to detect unexpected calls
  let originalEnd = res.end.bind(res);
  res.end = (...args) => {
    debug('res.end called', new Error('Stack trace').stack);
    return originalEnd(...args);
  };

  // Create our own AbortController to isolate from Express quirks
  let abortController = new AbortController();

  // Set up periodic keep-alive to prevent proxy timeouts
  let keepAliveInterval = setInterval(() => {
    if (!aborted) {
      res.write(':heartbeat\n\n');
      if (res.flush)
        res.flush();
    }
  }, 15000); // Every 15 seconds

  // Helper to send SSE events
  function sendEvent(event, data) {
    if (aborted) {
      debug('sendEvent called but already aborted, skipping:', event);
      return false;
    }

    let payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    let writeResult = res.write(payload);
    debug('sendEvent write result:', { event, writeResult, payloadLength: payload.length });

    // Flush to ensure data is sent immediately (important for SSE)
    if (typeof res.flush === 'function') {
      res.flush();
    } else if (res.socket && !res.socket.destroyed) {
      // Force flush by writing empty string and using socket
      res.socket.uncork?.();
    }

    // Also broadcast to WebSocket for other connected clients
    broadcastToUser(req.user.id, {
      type:      `stream_${event}`,
      sessionId: req.params.sessionId,
      ...data,
    });

    return writeResult;
  }

  // Handle client disconnect
  // NOTE: We use res.on('close') instead of req.on('close') because
  // express.json() middleware causes req.on('close') to fire prematurely
  // after it finishes consuming the request body, even though the SSE
  // response stream is still active. res.on('close') correctly fires
  // only when the client actually disconnects or the response ends.
  let aborted = false;
  res.on('close', () => {
    // Only set aborted if we didn't end the response ourselves
    if (!res.writableEnded) {
      debug('Client disconnected (res close before writableEnded)');
      aborted = true;
      abortController.abort();
      clearInterval(keepAliveInterval);
    } else {
      debug('Response ended normally (res close after writableEnded)');
    }
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
      SELECT id, role, content, hidden, type, created_at
      FROM messages
      WHERE session_id = ?
      ORDER BY created_at ASC
    `).all(req.params.sessionId);

    // Create agent
    debug('Creating agent', { type: session.agent_type, hasApiKey: !!apiKey, hasApiUrl: !!session.agent_api_url });
    let agent = createAgent(session.agent_type, {
      apiKey: apiKey,
      apiUrl: session.agent_api_url,
      system: session.system_prompt,
      ...agentConfig,
    });
    debug('Agent created successfully');

    // Build messages array for agent
    let messages = [];

    // =========================================================================
    // FIRST MESSAGE FLOW: Process onstart abilities before user's message
    // =========================================================================
    if (existingMessages.length === 0) {
      debug('First message in session, checking for onstart abilities');

      let startupAbilities = getStartupAbilities();
      let startupContent   = startupAbilities
        .filter((a) => a.type === 'process' && a.content)
        .map((a) => a.content)
        .join('\n\n---\n\n');

      if (startupContent) {
        debug('Processing onstart abilities', { abilityCount: startupAbilities.length });

        // Check if already aborted
        if (aborted) {
          debug('Aborted before onstart processing');
          clearInterval(keepAliveInterval);
          res.end();
          return;
        }

        // Send event to indicate we're processing onstart
        sendEvent('onstart_processing', {
          sessionId: req.params.sessionId,
          message:   'Processing initialization...',
        });

        try {
          // Send heartbeats during onstart processing to keep connection alive
          let onstartHeartbeat = setInterval(() => {
            if (!aborted) {
              debug('Sending onstart heartbeat');
              res.write(':heartbeat\n\n');
            }
          }, 1000);

          // Make non-streaming call to agent for onstart acknowledgment
          let ackContent;
          try {
            ackContent = await processOnstartAbilities(agent, startupContent);
          } finally {
            clearInterval(onstartHeartbeat);
          }

          // Check if aborted during onstart processing
          if (aborted) {
            debug('Aborted during onstart processing');
            clearInterval(keepAliveInterval);
            res.end();
            return;
          }

          // Store onstart user message (hidden, type=system)
          let onstartUserContent = `[System Initialization]\n\n${startupContent}`;
          storeAndBroadcastMessage(db, req.params.sessionId, req.user.id, 'user', onstartUserContent, {
            hidden: 1,
            type:   'system',
          });

          // Store agent acknowledgment (hidden, type=system)
          storeAndBroadcastMessage(db, req.params.sessionId, req.user.id, 'assistant', ackContent, {
            hidden: 1,
            type:   'system',
          });

          // Add to messages array for context
          messages.push({ role: 'user', content: onstartUserContent });
          messages.push({ role: 'assistant', content: ackContent });

          sendEvent('onstart_complete', {
            sessionId: req.params.sessionId,
            message:   'Initialization complete',
          });
        } catch (onstartError) {
          debug('Onstart error:', onstartError.message);
          sendEvent('onstart_error', {
            sessionId: req.params.sessionId,
            error:     onstartError.message,
          });
          // Continue anyway - the user's message can still be processed
        }
      }
    } else {
      // Load messages using snapshot system (handles compaction automatically)
      messages = loadMessagesWithSnapshot(req.params.sessionId, 20);
      debug('Loaded messages with snapshot system', { count: messages.length });
    }

    // =========================================================================
    // USER MESSAGE: Store and stream response
    // =========================================================================

    // Store user message
    storeAndBroadcastMessage(db, req.params.sessionId, req.user.id, 'user', content, {
      hidden: 0,
      type:   'message',
    });

    db.prepare('UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.sessionId);

    // Process any interactions in the user message (e.g., prompt updates)
    // User interactions are "secure" because they come directly from an authenticated user
    console.log('[Stream] User message content preview:', content.substring(0, 200));
    console.log('[Stream] User message has <interaction>:', content.includes('<interaction>'));
    if (content.includes('<interaction>')) {
      let userInteractionBlock = detectInteractions(content);
      console.log('[Stream] User interaction block:', userInteractionBlock ? `found ${userInteractionBlock.interactions.length}` : 'none');
      if (userInteractionBlock && userInteractionBlock.interactions.length > 0) {
        // Include senderId to mark these as authorized user interactions
        // This is secure because:
        // 1. This code path is only reached for user messages (not agent responses)
        // 2. req.user.id comes from authenticated session middleware
        // 3. detectInteractions() strips any sender_id that might have been in the message
        let interactionContext = {
          sessionId: req.params.sessionId,
          userId:    req.user.id,
          senderId:  req.user.id,  // Mark as authorized user interaction
          agentId:   session.agent_id,
          db,
        };
        console.log('[Stream] Executing user message interactions (authorized):', userInteractionBlock.interactions.length);
        let results = await executeInteractions(userInteractionBlock, interactionContext);
        console.log('[Stream] User interaction results:', JSON.stringify(results, null, 2));
      }
    }

    // =========================================================================
    // CONDITIONAL ABILITIES: Check if any abilities should activate
    // =========================================================================
    let conditionalResult = await checkConditionalAbilities({
      userMessage: content,
      sessionID:   parseInt(req.params.sessionId, 10),
    });

    if (conditionalResult.matched) {
      debug('Conditional abilities matched:', conditionalResult.instructions.length);

      // Format and inject instructions into the user message
      let conditionalInstructions = formatConditionalInstructions(conditionalResult.instructions);
      processedContent = `${processedContent}\n\n${conditionalInstructions}`;

      debug('Injected conditional instructions:', conditionalInstructions.slice(0, 200));
    }

    // Add user message to context (with process injection and conditional instructions)
    messages.push({ role: 'user', content: processedContent });

    // Calculate estimated tokens for display
    let totalChars = 0;
    for (let msg of messages) {
      let content = (typeof msg.content === 'string') ? msg.content : JSON.stringify(msg.content);
      totalChars += content.length;
    }
    // Add system prompt length if present
    if (session.system_prompt) {
      totalChars += session.system_prompt.length;
    }
    // Rough estimate: ~4 chars per token for English
    let estimatedTokens = Math.ceil(totalChars / 4);

    // Send stream start event with token estimate
    let messageId = randomUUID();  // UUID for correlating SSE events during streaming
    let persistedMessageID = null;  // Database row ID, set when message is stored
    debug('Sending message_start event', { messageId, estimatedTokens });
    sendEvent('message_start', {
      messageId,
      sessionId:       req.params.sessionId,
      agentName:       session.agent_name,
      estimatedTokens: estimatedTokens,
      messageCount:    messages.length,
    });

    // Create streaming HML parser
    let parser           = createStreamParser();
    let fullContent      = '';
    let executedElements = [];
    let chunkCount       = 0;

    // Set up parser event handlers
    parser.on('text', (data) => {
      if (!aborted)
        sendEvent('text', { messageId, ...data });
    });

    // Track pending websearch elements by ID for matching start/complete
    let pendingWebsearches = new Map();

    parser.on('element_start', (data) => {
      if (aborted)
        return;

      // For websearch, send interaction_started immediately when opening tag detected
      if (data.type === 'websearch' && data.executable) {
        let interactionId = `websearch-${data.id}`;
        pendingWebsearches.set(data.id, { interactionId, startTime: Date.now() });

        console.log(`[Stream] Websearch opening tag detected, sending interaction_started`);

        // Get banner config from the websearch function's registration
        let bannerConfig = getFunctionBannerConfig('websearch');

        sendEvent('interaction_started', {
          messageId,
          interactionId:  interactionId,
          targetId:       '@system',
          targetProperty: 'websearch',
          payload:        { query: '...' }, // Query not known yet
          banner:         bannerConfig,     // Include banner config for frontend
        });

        // Force flush: write padding and drain the socket
        // The AI sends <websearch>query</websearch> in one chunk, so we need
        // to ensure this event reaches the client before element_complete fires
        res.write(':flush\n\n');
        if (res.socket && !res.socket.destroyed) {
          res.socket.uncork?.();
          // Explicitly drain by writing directly to socket
          res.socket.write('', 'utf8');
        }

        console.log(`[Stream] Flushed interaction_started for websearch`);
        return; // Don't send element_start for websearch - we use interaction events instead
      }

      sendEvent('element_start', { messageId, ...data });
    });

    parser.on('element_update', (data) => {
      if (aborted)
        return;
      // Skip element_update for websearch - we use interaction events instead
      if (data.type === 'websearch')
        return;
      sendEvent('element_update', { messageId, ...data });
    });

    parser.on('element_complete', async (data) => {
      console.log('[Stream] element_complete fired:', data.type, data.executable, data.content?.slice(0, 50));
      if (aborted)
        return;

      // Handle websearch specially - interaction_started was already sent in element_start
      if (data.type === 'websearch' && data.executable) {
        let query = data.content?.trim();
        let pending = pendingWebsearches.get(data.id);

        if (query && pending) {
          let t0 = pending.startTime;
          console.log(`[Stream] Websearch closing tag, query: "${query}", elapsed since start: ${Date.now() - t0}ms`);

          // Update the banner with the actual query (we sent "..." at element_start)
          sendEvent('interaction_update', {
            messageId,
            interactionId:  pending.interactionId,
            targetProperty: 'websearch',
            payload:        { query },
          });
          console.log(`[Stream] T+${Date.now() - t0}ms: interaction_update sent with query`);

          // Yield to event loop to allow events to flush to client
          // This is needed because AI sends <websearch>query</websearch> in one chunk
          await new Promise(resolve => setImmediate(resolve));
          console.log(`[Stream] T+${Date.now() - t0}ms: Yielded event loop`);

          // Execute websearch (interaction_started was already sent in element_start)
          let result = await searchWeb(query);
          console.log(`[Stream] T+${Date.now() - t0}ms: searchWeb completed`);

          // Send interaction_result
          sendEvent('interaction_result', {
            messageId,
            interactionId:  pending.interactionId,
            targetProperty: 'websearch',
            status:         'completed',
            result:         result,
          });
          console.log(`[Stream] T+${Date.now() - t0}ms: interaction_result event sent`);

          executedElements.push({
            element: data,
            result:  result,
          });

          pendingWebsearches.delete(data.id);
        }
        return; // Don't send element_complete for websearch
      }

      sendEvent('element_complete', { messageId, ...data });

      // Execute if executable (websearch already handled above)
      if (data.executable) {
        try {
          // For other executable elements, use pipeline
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
              id:   data.id,
              type: data.type,
            });

            let pipelineResult = await executePipeline({
              mode:       'sequential',
              assertions: [assertion],
            }, context);

            let result = pipelineResult.results?.[0] || null;

            sendEvent('element_result', {
              messageId,
              id:     data.id,
              type:   data.type,
              result: result,
            });

            executedElements.push({
              element: data,
              result:  result,
            });
          }
        } catch (error) {
          sendEvent('element_error', {
            messageId,
            id:    data.id,
            type:  data.type,
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
    debug('Starting agent stream', { messageCount: messages.length, aborted });

    // Check if already aborted before starting
    if (aborted) {
      debug('Request already aborted before stream started');
      clearInterval(keepAliveInterval);
      res.end();
      return;
    }

    // Send a progress event to keep connection alive while waiting for API
    sendEvent('stream_connecting', {
      messageId,
      status: 'connecting_to_ai',
    });

    // Send an immediate heartbeat before the async API call
    debug('Sending pre-API heartbeat');
    res.write(':pre-api\n\n');

    // Heartbeat to keep connection alive during API call (API connection may take 1-2 seconds)
    let apiHeartbeat = setInterval(() => {
      debug('API heartbeat tick', { aborted });
      if (!aborted) {
        res.write(':heartbeat\n\n');
      }
    }, 1000); // Every second

    debug('Entering agent stream');

    try {
      for await (let chunk of agent.sendMessageStream(messages, { signal: abortController.signal })) {
        // Clear heartbeat once we start receiving chunks
        if (apiHeartbeat) {
          clearInterval(apiHeartbeat);
          apiHeartbeat = null;
        }
        if (aborted) {
          debug('Aborted, breaking stream loop');
          break;
        }

        chunkCount++;

        if (chunk.type === 'text') {
          debug(`Chunk #${chunkCount}: text`, { length: chunk.text.length });
          fullContent += chunk.text;
          parser.write(chunk.text);
        } else if (chunk.type === 'tool_use_start') {
          debug(`Chunk #${chunkCount}: tool_use_start`, chunk);
          sendEvent('tool_use_start', { messageId, ...chunk });
        } else if (chunk.type === 'tool_use_input') {
          debug(`Chunk #${chunkCount}: tool_use_input`);
          sendEvent('tool_use_input', { messageId, ...chunk });
        } else if (chunk.type === 'tool_result') {
          debug(`Chunk #${chunkCount}: tool_result`);
          sendEvent('tool_result', { messageId, ...chunk });
        } else if (chunk.type === 'usage') {
          debug(`Chunk #${chunkCount}: usage`, chunk);
          sendEvent('usage', {
            messageId,
            input_tokens:  chunk.input_tokens,
            output_tokens: chunk.output_tokens,
          });

          // Calculate cost in cents
          let inputTokens = chunk.input_tokens || 0;
          let outputTokens = chunk.output_tokens || 0;
          let inputCost = inputTokens * (0.003 / 1000);  // $3 per 1M input tokens
          let outputCost = outputTokens * (0.015 / 1000);  // $15 per 1M output tokens
          let costCents = Math.round((inputCost + outputCost) * 100);

          // Record charge in token_charges table
          // Note: message_id is NULL during streaming since the message isn't stored yet
          // The messageId variable is a UUID for SSE correlation, not a database ID
          db.prepare(`
            INSERT INTO token_charges (agent_id, session_id, message_id, input_tokens, output_tokens, cost_cents, charge_type)
            VALUES (?, ?, NULL, ?, ?, ?, 'usage')
          `).run(session.agent_id, req.params.sessionId, inputTokens, outputTokens, costCents);

          // Also update session totals for backwards compatibility
          db.prepare(`
            UPDATE sessions
            SET input_tokens = input_tokens + ?,
                output_tokens = output_tokens + ?
            WHERE id = ?
          `).run(inputTokens, outputTokens, req.params.sessionId);
        } else if (chunk.type === 'done') {
          debug(`Chunk #${chunkCount}: done`, { stopReason: chunk.stopReason });
          // End the parser
          parser.end();
        } else {
          debug(`Chunk #${chunkCount}: unknown type`, chunk);
        }
      }
      debug('Agent stream loop complete', { chunkCount, fullContentLength: fullContent.length });
    } catch (streamError) {
      console.error('Stream error from agent:', streamError);
      debug('Stream error:', streamError.message, streamError.stack);

      // Convert raw error to user-friendly message
      let errorMessage = getFriendlyErrorMessage(streamError.message);
      debug('Storing error message to database');
      storeAndBroadcastMessage(db, req.params.sessionId, req.user.id, 'assistant', errorMessage, {
        hidden: 0,
        type:   'error',
      });

      // Send error event to frontend
      sendEvent('error', {
        messageId,
        error: errorMessage,
      });

      // Mark that we've handled the error (don't send message_complete)
      aborted = true;
    } finally {
      // Clean up API heartbeat if still running
      if (apiHeartbeat) {
        clearInterval(apiHeartbeat);
        apiHeartbeat = null;
      }
    }

    // Always end the parser (handles any remaining buffered content)
    debug('Ending parser');
    parser.end();

    // =========================================================================
    // INTERACTION HANDLING: Detect and execute <interaction> tags
    // Implements an agentic loop that continues until Claude gives a final
    // response without interactions (or max iterations reached).
    // =========================================================================
    console.log('[Stream] Checking for interactions, aborted:', aborted, 'contentLength:', fullContent?.length);
    console.log('[Stream] Content preview:', fullContent?.slice(0, 500));
    console.log('[Stream] Has <interaction> tag:', fullContent?.includes('<interaction>'));
    console.log('[Stream] Has <websearch> tag:', fullContent?.includes('<websearch>'));
    if (!aborted && fullContent) {
      let interactionBlock = detectInteractions(fullContent);
      console.log('[Stream] detectInteractions result:', interactionBlock ? `found ${interactionBlock.interactions?.length} interactions` : 'none');

      if (interactionBlock) {
        // Build context for interaction execution
        let interactionContext = {
          sessionId: req.params.sessionId,
          userId:    req.user.id,
          dataKey:   dataKey,
        };

        // Agentic loop - continue until no more interactions or max iterations
        let maxIterations    = 15;
        let iteration        = 0;
        let currentContent   = fullContent;
        let currentBlock     = interactionBlock;
        // Track only the final response (not accumulated segments)
        // The initial response with interactions is stored as hidden, only the final is shown
        let finalContent     = null;

        while (currentBlock && iteration < maxIterations) {
          iteration++;
          debug(`Interaction loop iteration ${iteration}`, { count: currentBlock.interactions.length });
          debug(`Current content (first 200 chars):`, currentContent.slice(0, 200));

          // Send event to show interaction is being processed
          sendEvent('interaction_detected', {
            messageId,
            count:     currentBlock.interactions.length,
            iteration: iteration,
          });

          // Send interaction_started events RIGHT BEFORE execution
          // This ensures the "Pending" banner appears immediately when the action starts
          // Only functions with a banner config in their register() method will show banners
          for (let interaction of currentBlock.interactions) {
            // Get banner config from function's register() method (if it has one)
            let bannerConfig = getFunctionBannerConfig(interaction.target_property);
            console.log('[Stream] Sending interaction_started:', interaction.interaction_id, interaction.target_property, 'hasBanner:', !!bannerConfig);
            sendEvent('interaction_started', {
              messageId,
              interactionId:  interaction.interaction_id,
              targetId:       interaction.target_id,
              targetProperty: interaction.target_property,
              payload:        interaction.payload,
              banner:         bannerConfig,  // Include banner config (may be null)
            });
          }

          // Force flush to ensure events are sent immediately before blocking on execution
          res.write(':executing\n\n');
          if (res.flush) res.flush();

          // Store the interaction request as HIDDEN (intermediate message)
          storeAndBroadcastMessage(db, req.params.sessionId, req.user.id, 'assistant', currentContent, {
            hidden:        1,
            type:          'interaction',
            skipBroadcast: true,
          });

          // Execute interactions
          let results = await executeInteractions(currentBlock, interactionContext);
          debug('Interaction results', { count: results.results.length });

          // Send interaction results to frontend
          for (let result of results.results) {
            sendEvent('interaction_result', {
              messageId,
              interactionId:  result.interaction_id,
              targetProperty: result.target_property,
              status:         result.status,
              result:         (result.status === 'completed') ? result.result : null,
              error:          (result.status === 'failed') ? result.error : null,
              reason:         (result.status === 'denied') ? result.reason : null,
            });
          }

          // Format results as feedback
          let feedback = formatInteractionFeedback(results);

          // Store feedback as hidden message
          storeAndBroadcastMessage(db, req.params.sessionId, req.user.id, 'user', feedback, {
            hidden: 1,
            type:   'feedback',
          });

          // Add to message history (strip interaction tags so Claude sees clean context)
          // This prevents Claude from being confused by seeing its own <interaction> tags
          let cleanContentForHistory = stripInteractionTags(currentContent);
          messages.push({ role: 'assistant', content: cleanContentForHistory });
          messages.push({ role: 'user', content: feedback });

          debug('Getting next response from agent after interaction');
          sendEvent('interaction_continuing', { messageId, iteration });

          // Get next response from agent (with rate limit retry)
          let maxRetries   = 3;
          let retryCount   = 0;
          let gotResponse  = false;

          while (!gotResponse && retryCount < maxRetries) {
            try {
              let nextResponse = await agent.sendMessage(messages, {});
              let nextContent  = '';

              if (typeof nextResponse.content === 'string') {
                nextContent = nextResponse.content;
              } else if (Array.isArray(nextResponse.content)) {
                nextContent = nextResponse.content
                  .filter((block) => block.type === 'text')
                  .map((block) => block.text)
                  .join('');
              }

              debug('Next response received', { length: nextContent.length, iteration });
              debug('Next response content (first 300 chars):', nextContent.slice(0, 300));

              // Keep track of the clean content for final display
              // Only the last response (after all interactions complete) will be shown
              let cleanSegment = stripInteractionTags(nextContent);
              if (cleanSegment.trim()) {
                finalContent = cleanSegment;
              }

              // Check if this response also has interactions
              currentContent = nextContent;
              currentBlock   = detectInteractions(nextContent);
              debug('Has more interactions:', !!currentBlock);

              // If no more interactions, we're done
              if (!currentBlock) {
                debug('No more interactions, loop complete');
              }

              gotResponse = true;
            } catch (error) {
              // Check if it's a rate limit error (429)
              let isRateLimit = error.message?.includes('429') || error.message?.includes('rate_limit');

              if (isRateLimit && retryCount < maxRetries - 1) {
                retryCount++;
                let waitSeconds = 30;
                debug('Rate limit hit, waiting before retry', { retryCount, waitSeconds });
                // Just wait silently - frontend keeps showing "Processing..." spinner
                await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
                debug('Retry wait complete, attempting again');
              } else {
                debug('Error getting next response:', error.message);
                let friendlyError = getFriendlyErrorMessage(error.message);
                sendEvent('interaction_error', { messageId, error: friendlyError });
                currentBlock = null; // Exit loop on error
                gotResponse  = true; // Exit retry loop
              }
            }
          }
        }

        if (iteration >= maxIterations) {
          debug('Max interaction iterations reached');
          sendEvent('interaction_max_reached', { messageId, iterations: iteration });
        }

        // Use the final response content (after all interactions complete)
        // If no follow-up response was received, fall back to stripped initial content
        let cleanFinalContent = finalContent || stripInteractionTags(fullContent);

        // Strip any leaked interaction feedback format ([@target:method] interaction_id=...)
        // This can happen if Claude echoes the feedback in its response
        cleanFinalContent = cleanFinalContent.replace(/\[@[^\]]+\]\s*interaction_id='[^']+'\s*(status:|completed:|failed:|denied:)[^\n]*(\n\{[\s\S]*?\n\})?/g, '').trim();

        // Clean up extra whitespace
        cleanFinalContent = cleanFinalContent.replace(/\n{3,}/g, '\n\n').trim();

        // Store the final clean response as VISIBLE
        if (cleanFinalContent.trim()) {
          let storedMsg = storeAndBroadcastMessage(db, req.params.sessionId, req.user.id, 'assistant', cleanFinalContent, {
            hidden:        0,
            type:          'message',
            skipBroadcast: true,
          });
          persistedMessageID = storedMsg.id;
          debug('Stored interaction response with database ID:', persistedMessageID);
        }

        // Update fullContent for the message_complete event
        fullContent = cleanFinalContent;

        // Send the final content to frontend
        sendEvent('interaction_complete', {
          messageId,
          content:    cleanFinalContent,
          iterations: iteration,
        });

      } else {
        // No interactions - store normally
        debug('Storing assistant response', { length: fullContent.length });
        let storedMsg = storeAndBroadcastMessage(db, req.params.sessionId, req.user.id, 'assistant', fullContent, {
          hidden:        0,
          type:          'message',
          skipBroadcast: true,  // SSE already notifies client via message_complete
        });
        persistedMessageID = storedMsg.id;
        debug('Stored message with database ID:', persistedMessageID);
      }
    } else if (!aborted && !fullContent) {
      // No content received - store an error message so user knows what happened
      console.warn('[Stream] Warning: Agent returned no content', {
        sessionId:  req.params.sessionId,
        messageId:  messageId,
        chunkCount: chunkCount,
      });
      debug('Agent returned no content - storing error message');

      let errorMessage = 'The agent did not return a response. This may indicate an API issue or rate limiting.';
      storeAndBroadcastMessage(db, req.params.sessionId, req.user.id, 'assistant', errorMessage, {
        hidden: 0,
        type:   'error',
      });

      sendEvent('error', {
        messageId,
        error: errorMessage,
      });

      // Mark as handled so we don't send message_complete
      aborted = true;
    } else {
      debug('Not storing response', { aborted, hasContent: !!fullContent });
    }

    // Always send message_complete so frontend can finalize
    if (!aborted) {
      // If no content, include a warning
      if (!fullContent) {
        debug('Sending message_complete with empty content warning');
        sendEvent('message_complete', {
          messageId,
          content:          '',
          executedElements: executedElements.length,
          warning:          'Agent returned no content',
        });
      } else {
        debug('Sending message_complete', { contentLength: fullContent.length, executedElements: executedElements.length, persistedMessageID });
        sendEvent('message_complete', {
          messageId,
          persistedMessageID,  // The actual database row ID for persistence
          content:          fullContent,
          executedElements: executedElements.length,
        });
      }
    }

    // Check if compaction is needed (debounced)
    if (!aborted && fullContent) {
      checkCompaction(req.params.sessionId, req.user.id, agent).then((result) => {
        if (result.success) {
          debug('Compaction completed', result);
        } else if (result.debounced) {
          debug('Compaction debounced');
        }
      }).catch((err) => {
        console.error('[Stream] Compaction check error:', err);
      });
    }

    // End SSE stream - add small delay to ensure all events are flushed to client
    debug('Ending SSE stream');
    clearInterval(keepAliveInterval);

    // Small delay to ensure final events are transmitted before connection closes
    await new Promise((resolve) => setTimeout(resolve, 100));

    res.end();
  } catch (error) {
    console.error('Stream error:', error);
    debug('Outer catch error:', error.message, error.stack);
    clearInterval(keepAliveInterval);

    // Store error message to database so it persists
    let errorMessage = getFriendlyErrorMessage(error.message);
    try {
      let db = getDatabase();
      storeAndBroadcastMessage(db, req.params.sessionId, req.user.id, 'assistant', errorMessage, {
        hidden: 0,
        type:   'error',
      });
    } catch (dbError) {
      console.error('Failed to store error message:', dbError);
    }

    sendEvent('error', { error: errorMessage });
    res.end();
  }
});

/**
 * Convert HML element to assertion format for pipeline execution.
 * Note: websearch is handled by the interaction system, not HML pipeline.
 */
function elementToAssertion(element) {
  switch (element.type) {
    case 'websearch':
      // Websearch is handled by the interaction system via <interaction> tags,
      // not through HML element execution. Return null to skip pipeline execution.
      return null;

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
