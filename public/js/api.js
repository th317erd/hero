'use strict';

// ============================================================================
// API Functions
// ============================================================================

async function api(method, path, body) {
  let options = {
    method:      method,
    credentials: 'same-origin',
    headers:     {},
  };

  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response = await fetch(`api${path}`, options);
  let data     = await response.json();

  if (!response.ok)
    throw new Error(data.error || 'Request failed');

  return data;
}

async function login(username, password) {
  return await api('POST', '/login', { username, password });
}

async function logout() {
  return await api('POST', '/logout');
}

async function fetchMe() {
  return await api('GET', '/me');
}

async function fetchSessions(options = {}) {
  let params = new URLSearchParams();

  if (options.showHidden || state.showHidden)
    params.append('showHidden', '1');

  if (options.search)
    params.append('search', options.search);

  let queryString = params.toString();
  let path        = (queryString) ? `/sessions?${queryString}` : '/sessions';
  let data        = await api('GET', path);

  return data.sessions;
}

async function fetchSession(id) {
  return await api('GET', `/sessions/${id}`);
}

async function createSession(name, agentId, systemPrompt) {
  return await api('POST', '/sessions', { name, agentId, systemPrompt });
}

async function sendMessage(sessionId, content) {
  return await api('POST', `/sessions/${sessionId}/messages`, { content });
}

/**
 * Send a message with streaming response via SSE.
 *
 * @param {number} sessionId - Session ID
 * @param {string} content - Message content
 * @param {object} callbacks - Event callbacks
 * @returns {Promise<object>} Final response
 */
async function sendMessageStream(sessionId, content, callbacks = {}) {
  debug('API', 'sendMessageStream called', { sessionId, contentLength: content.length });

  return new Promise((resolve, reject) => {
    let url = `${BASE_PATH}/api/sessions/${sessionId}/messages/stream`;
    debug('API', 'Fetching stream URL:', url);

    fetch(url, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ content }),
      credentials: 'same-origin',
    }).then(async (response) => {
      debug('API', 'Stream response received', {
        status:      response.status,
        ok:          response.ok,
        headers:     Object.fromEntries(response.headers.entries()),
        bodyUsed:    response.bodyUsed,
        redirected:  response.redirected,
      });

      if (!response.ok) {
        let error = await response.json().catch(() => ({ error: 'Stream failed' }));
        debug('API', 'Stream error response:', error);
        reject(new Error(error.error || 'Stream failed'));
        return;
      }

      let reader      = response.body.getReader();
      let decoder     = new TextDecoder();
      let buffer      = '';
      let fullContent = '';
      let messageId   = null;
      let chunkCount  = 0;
      let eventCount  = 0;
      let eventType   = null;  // Persist across chunks for multi-chunk events
      let eventData   = null;

      debug('API', 'Starting to read stream...');

      try {
        while (true) {
          let readResult;
          try {
            readResult = await reader.read();
          } catch (readError) {
            debug('API', 'reader.read() threw error:', readError.message);
            throw readError;
          }

          let { done, value } = readResult;

          if (done) {
            debug('API', 'Stream done', { chunkCount, eventCount, fullContentLength: fullContent.length });
            break;
          }

          chunkCount++;
          let chunk = decoder.decode(value, { stream: true });
          debug('API', `Chunk #${chunkCount} received`, { length: chunk.length, preview: chunk.slice(0, 100) });

          buffer += chunk;

          // Parse SSE events from buffer
          let lines = buffer.split('\n');
          buffer    = lines.pop(); // Keep incomplete line in buffer

          for (let line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              eventData = line.slice(6);
            } else if (line === '' && eventType && eventData) {
              // End of event
              eventCount++;
              console.log(`[TRACE-API] Event #${eventCount} received: ${eventType}`);
              debug('API', `Event #${eventCount}:`, eventType);

              try {
                let data = JSON.parse(eventData);
                debug('API', `Event data:`, data);

                // Track message ID
                if (data.messageId)
                  messageId = data.messageId;

                // Call appropriate callback
                switch (eventType) {
                  case 'message_start':
                    debug('API', 'Calling onStart callback');
                    callbacks.onStart?.(data);
                    break;

                  case 'text':
                    fullContent += data.text;
                    debug('API', 'Calling onText callback', { textLength: data.text.length, totalLength: fullContent.length });
                    callbacks.onText?.(data);
                    break;

                  case 'element_start':
                    debug('API', 'Calling onElementStart callback');
                    callbacks.onElementStart?.(data);
                    break;

                  case 'element_update':
                    debug('API', 'Calling onElementUpdate callback');
                    callbacks.onElementUpdate?.(data);
                    break;

                  case 'element_complete':
                    debug('API', 'Calling onElementComplete callback');
                    callbacks.onElementComplete?.(data);
                    break;

                  case 'element_executing':
                    debug('API', 'Calling onElementExecuting callback');
                    callbacks.onElementExecuting?.(data);
                    break;

                  case 'element_result':
                    debug('API', 'Calling onElementResult callback');
                    callbacks.onElementResult?.(data);
                    break;

                  case 'element_error':
                    debug('API', 'Calling onElementError callback');
                    callbacks.onElementError?.(data);
                    break;

                  case 'tool_use_start':
                    debug('API', 'Calling onToolUseStart callback');
                    callbacks.onToolUseStart?.(data);
                    break;

                  case 'tool_result':
                    debug('API', 'Calling onToolResult callback');
                    callbacks.onToolResult?.(data);
                    break;

                  // Interaction events (for <interaction> tag handling)
                  case 'interaction_detected':
                    debug('API', 'Calling onInteractionDetected callback');
                    callbacks.onInteractionDetected?.(data);
                    break;

                  case 'interaction_started':
                    console.log('[TRACE-API] interaction_started event received:', data);
                    debug('API', 'Calling onInteractionStarted callback', data);
                    callbacks.onInteractionStarted?.(data);
                    break;

                  case 'interaction_update':
                    console.log('[TRACE-API] interaction_update event received:', data);
                    debug('API', 'Calling onInteractionUpdate callback', data);
                    callbacks.onInteractionUpdate?.(data);
                    break;

                  case 'interaction_result':
                    console.log('[TRACE-API] interaction_result event received:', {
                      interactionId: data.interactionId,
                      status:        data.status,
                      hasResult:     !!data.result,
                    });
                    console.log('[TRACE-API] callbacks.onInteractionResult exists?', typeof callbacks.onInteractionResult);
                    debug('API', 'Calling onInteractionResult callback');
                    if (callbacks.onInteractionResult) {
                      try {
                        callbacks.onInteractionResult(data);
                        console.log('[TRACE-API] interaction_result callback completed');
                      } catch (callbackError) {
                        console.error('[TRACE-API] interaction_result callback THREW ERROR:', callbackError);
                      }
                    } else {
                      console.log('[TRACE-API] NO onInteractionResult callback defined!');
                    }
                    break;

                  case 'interaction_continuing':
                    debug('API', 'Calling onInteractionContinuing callback');
                    callbacks.onInteractionContinuing?.(data);
                    break;

                  case 'interaction_complete':
                    console.log('[TRACE-API] interaction_complete event received:', {
                      hasContent:      !!data.content,
                      contentLength:   data.content?.length,
                      contentPreview:  data.content?.slice(0, 100),
                    });
                    debug('API', 'Interaction complete, updating fullContent');
                    // Update the accumulated content with the final clean content
                    if (data.content) {
                      fullContent = data.content;
                    }
                    callbacks.onInteractionComplete?.(data);
                    break;

                  case 'interaction_error':
                    debug('API', 'Calling onInteractionError callback');
                    callbacks.onInteractionError?.(data);
                    break;

                  case 'rate_limit_wait':
                    debug('API', 'Rate limit wait:', data);
                    callbacks.onRateLimitWait?.(data);
                    break;

                  case 'usage':
                    debug('API', 'Token usage:', data);
                    callbacks.onUsage?.(data);
                    break;

                  case 'message_complete':
                    console.log('[TRACE-API] message_complete event received:', {
                      hasContent:      !!data.content,
                      contentLength:   data.content?.length,
                      contentPreview:  data.content?.slice(0, 100),
                    });
                    debug('API', 'Calling onComplete callback');
                    callbacks.onComplete?.(data);
                    break;

                  case 'error':
                    debug('API', 'Stream error event:', data);
                    callbacks.onError?.(data);
                    reject(new Error(data.error));
                    return;

                  default:
                    debug('API', 'Unknown event type:', eventType);
                }
              } catch (e) {
                console.error('Failed to parse SSE event:', e);
                debug('API', 'Parse error:', e.message, 'Raw data:', eventData);
              }

              eventType = null;
              eventData = null;
            }
          }
        }
      } catch (streamError) {
        debug('API', 'Stream processing error:', streamError.message);
        reject(streamError);
        return;
      }

      debug('API', 'Stream complete, resolving', { fullContentLength: fullContent.length, messageId });
      resolve({ content: fullContent, messageId });
    }).catch((error) => {
      debug('API', 'Fetch error:', error.message);
      reject(error);
    });
  });
}

async function clearMessages(sessionId) {
  return await api('DELETE', `/sessions/${sessionId}/messages`);
}

async function fetchAgents() {
  let data = await api('GET', '/agents');
  return data.agents;
}

async function createAgent(name, type, apiKey, apiUrl, defaultAbilities, config) {
  return await api('POST', '/agents', { name, type, apiKey, apiUrl, defaultAbilities, config });
}

async function fetchAbilities() {
  let data   = await api('GET', '/abilities');
  let system = data.abilities.filter((a) => a.source === 'system' || a.source === 'builtin');
  let user   = data.abilities.filter((a) => a.source === 'user');
  return { system, user };
}

async function fetchAbility(id) {
  return await api('GET', `/abilities/${id}`);
}

async function createAbility(name, description, applies, content) {
  return await api('POST', '/abilities', { name, description, applies, content, type: 'process' });
}

async function updateAbility(id, name, description, applies, content) {
  return await api('PUT', `/abilities/${id}`, { name, description, applies, content });
}

async function deleteAbility(id) {
  return await api('DELETE', `/abilities/${id}`);
}

async function fetchAgentConfig(id) {
  let data = await api('GET', `/agents/${id}/config`);
  return data.config;
}

async function updateAgentConfig(id, config) {
  return await api('PUT', `/agents/${id}/config`, { config });
}

async function deleteAgent(id) {
  return await api('DELETE', `/agents/${id}`);
}

async function fetchUsage() {
  return await api('GET', '/usage');
}

async function fetchSessionUsage(sessionId) {
  return await api('GET', `/usage/session/${sessionId}`);
}

async function recordCharge(data) {
  return await api('POST', '/usage/charge', data);
}

async function createUsageCorrection(data) {
  return await api('POST', '/usage/correction', data);
}
