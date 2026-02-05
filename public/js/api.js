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
  return new Promise((resolve, reject) => {
    fetch(`${BASE_PATH}/api/sessions/${sessionId}/messages/stream`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ content }),
      credentials: 'same-origin',
    }).then(async (response) => {
      if (!response.ok) {
        let error = await response.json().catch(() => ({ error: 'Stream failed' }));
        reject(new Error(error.error || 'Stream failed'));
        return;
      }

      let reader      = response.body.getReader();
      let decoder     = new TextDecoder();
      let buffer      = '';
      let fullContent = '';
      let messageId   = null;

      while (true) {
        let { done, value } = await reader.read();

        if (done)
          break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        let lines = buffer.split('\n');
        buffer    = lines.pop(); // Keep incomplete line in buffer

        let eventType = null;
        let eventData = null;

        for (let line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            eventData = line.slice(6);
          } else if (line === '' && eventType && eventData) {
            // End of event
            try {
              let data = JSON.parse(eventData);

              // Track message ID
              if (data.messageId)
                messageId = data.messageId;

              // Call appropriate callback
              switch (eventType) {
                case 'message_start':
                  callbacks.onStart?.(data);
                  break;

                case 'text':
                  fullContent += data.text;
                  callbacks.onText?.(data);
                  break;

                case 'element_start':
                  callbacks.onElementStart?.(data);
                  break;

                case 'element_update':
                  callbacks.onElementUpdate?.(data);
                  break;

                case 'element_complete':
                  callbacks.onElementComplete?.(data);
                  break;

                case 'element_executing':
                  callbacks.onElementExecuting?.(data);
                  break;

                case 'element_result':
                  callbacks.onElementResult?.(data);
                  break;

                case 'element_error':
                  callbacks.onElementError?.(data);
                  break;

                case 'tool_use_start':
                  callbacks.onToolUseStart?.(data);
                  break;

                case 'tool_result':
                  callbacks.onToolResult?.(data);
                  break;

                case 'message_complete':
                  callbacks.onComplete?.(data);
                  break;

                case 'error':
                  callbacks.onError?.(data);
                  reject(new Error(data.error));
                  return;
              }
            } catch (e) {
              console.error('Failed to parse SSE event:', e);
            }

            eventType = null;
            eventData = null;
          }
        }
      }

      resolve({ content: fullContent, messageId });
    }).catch(reject);
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

async function createAbility(name, description, content) {
  return await api('POST', '/abilities', { name, description, content, type: 'process' });
}

async function updateAbility(id, name, description, content) {
  return await api('PUT', `/abilities/${id}`, { name, description, content });
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
