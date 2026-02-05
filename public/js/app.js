'use strict';

// ============================================================================
// State
// ============================================================================

let state = {
  user:              null,
  sessions:          [],
  agents:            [],
  processes:         { system: [], user: [] },
  currentSession:    null,
  messages:          [],
  isLoading:         false,
  runningOperations: [],
  editingProcessId:  null,
  ws:                null,
  assertions:        {},  // Map of messageId -> [assertion, ...]
  pendingQuestions:  {},  // Map of assertionId -> { resolve, timeout }
};

// ============================================================================
// DOM Elements
// ============================================================================

const elements = {
  // Views
  loginView:    document.getElementById('login-view'),
  sessionsView: document.getElementById('sessions-view'),
  chatView:     document.getElementById('chat-view'),

  // Login
  loginForm:   document.getElementById('login-form'),
  loginError:  document.getElementById('login-error'),

  // Sessions
  sessionsList:   document.getElementById('sessions-list'),
  newSessionBtn:  document.getElementById('new-session-btn'),
  logoutBtn:      document.getElementById('logout-btn'),

  // Chat
  sessionTitle:   document.getElementById('session-title'),
  sessionSelect:  document.getElementById('session-select'),
  messagesContainer: document.getElementById('messages'),
  messageInput:   document.getElementById('message-input'),
  sendBtn:        document.getElementById('send-btn'),
  clearBtn:       document.getElementById('clear-btn'),
  backBtn:        document.getElementById('back-btn'),
  chatLogoutBtn:  document.getElementById('chat-logout-btn'),

  // New Session Modal
  newSessionModal:  document.getElementById('new-session-modal'),
  newSessionForm:   document.getElementById('new-session-form'),
  agentSelect:      document.getElementById('agent-select'),
  newSessionError:  document.getElementById('new-session-error'),
  cancelNewSession: document.getElementById('cancel-new-session'),

  // New Agent Modal
  newAgentModal:        document.getElementById('new-agent-modal'),
  newAgentForm:         document.getElementById('new-agent-form'),
  newAgentError:        document.getElementById('new-agent-error'),
  cancelNewAgent:       document.getElementById('cancel-new-agent'),
  agentProcessesList:   document.getElementById('agent-processes-list'),

  // Processes
  processesBtn:         document.getElementById('processes-btn'),
  processesModal:       document.getElementById('processes-modal'),
  closeProcessesModal:  document.getElementById('close-processes-modal'),
  systemProcessesList:  document.getElementById('system-processes-list'),
  userProcessesList:    document.getElementById('user-processes-list'),
  newProcessBtn:        document.getElementById('new-process-btn'),

  // Edit Process Modal
  editProcessModal:     document.getElementById('edit-process-modal'),
  editProcessTitle:     document.getElementById('edit-process-title'),
  editProcessForm:      document.getElementById('edit-process-form'),
  editProcessError:     document.getElementById('edit-process-error'),
  cancelEditProcess:    document.getElementById('cancel-edit-process'),

  // Operations Panel
  operationsPanel:      document.getElementById('operations-panel'),
  operationsList:       document.getElementById('operations-list'),
  toggleOperations:     document.getElementById('toggle-operations'),

  // Agents
  agentsBtn:            document.getElementById('agents-btn'),
  agentsModal:          document.getElementById('agents-modal'),
  closeAgentsModal:     document.getElementById('close-agents-modal'),
  addAgentFromList:     document.getElementById('add-agent-from-list'),
  agentsList:           document.getElementById('agents-list'),

  // Agent Config Modal
  agentConfigModal:     document.getElementById('agent-config-modal'),
  agentConfigForm:      document.getElementById('agent-config-form'),
  agentConfigId:        document.getElementById('agent-config-id'),
  agentConfigJson:      document.getElementById('agent-config-json'),
  agentConfigError:     document.getElementById('agent-config-error'),
  cancelAgentConfig:    document.getElementById('cancel-agent-config'),
};

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

async function fetchSessions() {
  let data = await api('GET', '/sessions');
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

async function clearMessages(sessionId) {
  return await api('DELETE', `/sessions/${sessionId}/messages`);
}

async function fetchAgents() {
  let data = await api('GET', '/agents');
  return data.agents;
}

async function createAgent(name, type, apiKey, apiUrl, defaultProcesses) {
  return await api('POST', '/agents', { name, type, apiKey, apiUrl, defaultProcesses });
}

async function fetchProcesses() {
  let data = await api('GET', '/processes');
  return data;
}

async function fetchProcess(id) {
  return await api('GET', `/processes/${id}`);
}

async function createProcess(name, description, content) {
  return await api('POST', '/processes', { name, description, content });
}

async function updateProcess(id, name, description, content) {
  return await api('PUT', `/processes/${id}`, { name, description, content });
}

async function deleteProcess(id) {
  return await api('DELETE', `/processes/${id}`);
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

// ============================================================================
// Routing
// ============================================================================

// Read base path from <base> tag (set by server from package.json config)
const BASE_PATH = document.querySelector('base')?.getAttribute('href')?.replace(/\/$/, '') || '';

function getRoute() {
  let path = window.location.pathname;

  // Strip base path
  if (path.startsWith(BASE_PATH))
    path = path.slice(BASE_PATH.length) || '/';

  if (path === '/login')
    return { view: 'login' };

  if (path === '/' || path === '')
    return { view: 'sessions' };

  let sessionMatch = path.match(/^\/sessions\/(\d+)$/);

  if (sessionMatch)
    return { view: 'chat', sessionId: parseInt(sessionMatch[1], 10) };

  // Unknown route, default to sessions
  return { view: 'sessions' };
}

function navigate(path) {
  window.history.pushState({}, '', BASE_PATH + path);
  handleRoute();
}

async function handleRoute() {
  let route = getRoute();

  // Check auth for non-login routes
  if (route.view !== 'login') {
    try {
      let me = await fetchMe();
      state.user = me;
      connectWebSocket();
    } catch (error) {
      // Not authenticated, show login
      disconnectWebSocket();
      showView('login');
      return;
    }
  }

  switch (route.view) {
    case 'login':
      disconnectWebSocket();
      showView('login');
      break;

    case 'sessions':
      await loadSessions();
      showView('sessions');
      break;

    case 'chat':
      await loadSession(route.sessionId);
      showView('chat');
      break;

    default:
      showView('sessions');
  }
}

// ============================================================================
// Views
// ============================================================================

function showView(viewName) {
  elements.loginView.style.display    = (viewName === 'login') ? 'flex' : 'none';
  elements.sessionsView.style.display = (viewName === 'sessions') ? 'flex' : 'none';
  elements.chatView.style.display     = (viewName === 'chat') ? 'flex' : 'none';
}

// ============================================================================
// Sessions
// ============================================================================

async function loadSessions() {
  try {
    state.sessions = await fetchSessions();
    state.agents   = await fetchAgents();
    renderSessionsList();
  } catch (error) {
    console.error('Failed to load sessions:', error);
    elements.sessionsList.innerHTML = '<div class="loading">Failed to load sessions</div>';
  }
}

function renderSessionsList() {
  if (state.sessions.length === 0) {
    if (state.agents.length === 0) {
      elements.sessionsList.innerHTML = `
        <div class="no-sessions">
          <p>No agents configured yet.</p>
          <p><span class="no-agents-link" onclick="showNewAgentModal()">Add an agent</span> to get started.</p>
        </div>
      `;
    } else {
      elements.sessionsList.innerHTML = `
        <div class="no-sessions">
          <p>No sessions yet.</p>
          <p>Click "New Session" to start chatting with an AI agent.</p>
        </div>
      `;
    }
    return;
  }

  let html = state.sessions.map((session) => `
    <div class="session-card" onclick="navigateToSession(${session.id})">
      <div class="session-card-title">${escapeHtml(session.name)}</div>
      <div class="session-card-meta">${session.messageCount} messages</div>
      <div class="session-card-agent">${escapeHtml(session.agent.name)} (${session.agent.type})</div>
    </div>
  `).join('');

  elements.sessionsList.innerHTML = html;
}

function navigateToSession(sessionId) {
  navigate(`/sessions/${sessionId}`);
}

// ============================================================================
// Chat
// ============================================================================

async function loadSession(sessionId) {
  try {
    let session    = await fetchSession(sessionId);
    state.currentSession = session;
    state.messages       = session.messages || [];

    elements.sessionTitle.textContent = session.name;

    // Update session dropdown
    await updateSessionSelect();

    renderMessages();
    scrollToBottom();

    // Focus input
    elements.messageInput.focus();
  } catch (error) {
    console.error('Failed to load session:', error);
    navigate('/');
  }
}

async function updateSessionSelect() {
  if (state.sessions.length === 0)
    state.sessions = await fetchSessions();

  let options = '<option value="">Switch session...</option>';

  for (let session of state.sessions) {
    let selected = (state.currentSession && session.id === state.currentSession.id) ? 'selected' : '';
    options += `<option value="${session.id}" ${selected}>${escapeHtml(session.name)}</option>`;
  }

  elements.sessionSelect.innerHTML = options;
}

function renderMessages() {
  let html = state.messages.map((message) => renderMessage(message)).join('');
  elements.messagesContainer.innerHTML = html;
  scrollToBottom();
}

function renderMessage(message) {
  let roleClass = (message.role === 'user') ? 'message-user' : 'message-assistant';
  let roleLabel = (message.role === 'user') ? 'You' : 'Assistant';
  let messageId = message.id || '';

  let contentHtml = '';

  if (typeof message.content === 'string') {
    contentHtml = `<div class="message-content">${escapeHtml(message.content)}</div>`;
  } else if (Array.isArray(message.content)) {
    for (let block of message.content) {
      if (block.type === 'text') {
        contentHtml += `<div class="message-content">${escapeHtml(block.text)}</div>`;
      } else if (block.type === 'tool_use') {
        contentHtml += renderToolUse(block);
      } else if (block.type === 'tool_result') {
        contentHtml += renderToolResult(block);
      }
    }
  }

  // Add assertion blocks for this message
  let assertionsHtml = messageId ? renderAssertionsForMessage(messageId) : '';

  return `
    <div class="message ${roleClass}" data-message-id="${messageId}">
      <div class="message-header">${roleLabel}</div>
      <div class="message-bubble">
        ${contentHtml}
        ${assertionsHtml}
      </div>
    </div>
  `;
}

function renderToolUse(block) {
  return `
    <div class="tool-call">
      <div class="tool-call-header">
        <span class="tool-call-icon">&#9881;</span>
        <span>Tool: ${escapeHtml(block.name)}</span>
      </div>
      <div class="tool-call-body">
        <div class="tool-call-section">
          <div class="tool-call-label">Input</div>
          <div class="tool-call-content">${escapeHtml(JSON.stringify(block.input, null, 2))}</div>
        </div>
      </div>
    </div>
  `;
}

function renderToolResult(block) {
  return `
    <div class="tool-call">
      <div class="tool-call-body">
        <div class="tool-call-section">
          <div class="tool-call-label">Result</div>
          <div class="tool-call-content">${escapeHtml(block.content)}</div>
        </div>
      </div>
    </div>
  `;
}

function renderAssertionBlock(assertion) {
  let { id, assertion: type, name, status, preview, result } = assertion;
  status = status || 'pending';

  if (type === 'thinking')
    return renderThinkingAssertion(assertion);

  if (type === 'question')
    return renderQuestionAssertion(assertion);

  if (type === 'response')
    return renderResponseAssertion(assertion);

  // Default: command assertion
  return `
    <div class="assertion-block assertion-${type}" data-assertion-id="${id}">
      <div class="assertion-header">
        <span class="assertion-type">${escapeHtml(type)}</span>
        <span class="assertion-name">${escapeHtml(name)}</span>
        <span class="assertion-status ${status}">${status}</span>
      </div>
      ${preview ? `<div class="assertion-preview"><pre>${escapeHtml(preview)}</pre></div>` : ''}
      ${result ? `<div class="assertion-result"><pre>${escapeHtml(typeof result === 'string' ? result : JSON.stringify(result, null, 2))}</pre></div>` : ''}
    </div>
  `;
}

function renderThinkingAssertion(assertion) {
  let { id, name, message, status } = assertion;
  let isRunning = (status === 'running' || status === 'pending' || !status);

  return `
    <div class="assertion-block thinking" data-assertion-id="${id}">
      ${isRunning ? `
        <div class="thinking-indicator">
          <span></span><span></span><span></span>
        </div>
      ` : ''}
      <span class="thinking-text">${escapeHtml(message || name || 'Processing...')}</span>
    </div>
  `;
}

function renderQuestionAssertion(assertion) {
  let { id, name, message, options, status, answer } = assertion;

  if (status === 'completed' && answer !== undefined) {
    return `
      <div class="assertion-block question answered" data-assertion-id="${id}">
        <div class="question-text">${escapeHtml(message)}</div>
        <div class="question-answer">Answer: ${escapeHtml(String(answer))}</div>
      </div>
    `;
  }

  let optionsHtml = '';
  if (Array.isArray(options) && options.length > 0) {
    optionsHtml = options.map((opt) =>
      `<button class="btn btn-secondary question-option" data-assertion-id="${id}" data-answer="${escapeHtml(String(opt))}">${escapeHtml(String(opt))}</button>`
    ).join('');
  }

  return `
    <div class="assertion-block question" data-assertion-id="${id}">
      <div class="question-text">${escapeHtml(message)}</div>
      <div class="question-actions">
        ${optionsHtml}
        <input type="text" class="question-input" placeholder="Type your answer..." data-assertion-id="${id}">
        <button class="btn btn-primary question-submit" data-assertion-id="${id}">Submit</button>
      </div>
    </div>
  `;
}

function renderResponseAssertion(assertion) {
  let { id, message } = assertion;

  return `
    <div class="assertion-block response" data-assertion-id="${id}">
      <div class="response-text">${escapeHtml(message)}</div>
    </div>
  `;
}

function renderAssertionsForMessage(messageId) {
  let assertions = state.assertions[messageId];
  if (!assertions || assertions.length === 0)
    return '';

  return assertions.map((a) => renderAssertionBlock(a)).join('');
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    let chatMain = elements.messagesContainer.parentElement;
    chatMain.scrollTop = chatMain.scrollHeight;
  });
}

function showTypingIndicator() {
  let indicator = document.createElement('div');
  indicator.className = 'message message-assistant';
  indicator.id = 'typing-indicator';
  indicator.innerHTML = `
    <div class="message-header">Assistant</div>
    <div class="message-bubble">
      <div class="typing-indicator">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;
  elements.messagesContainer.appendChild(indicator);
  scrollToBottom();
}

function hideTypingIndicator() {
  let indicator = document.getElementById('typing-indicator');

  if (indicator)
    indicator.remove();
}

async function handleSendMessage() {
  let content = elements.messageInput.value.trim();

  if (!content || state.isLoading || !state.currentSession)
    return;

  state.isLoading = true;
  elements.sendBtn.disabled     = true;
  elements.messageInput.value   = '';
  elements.messageInput.style.height = 'auto';

  // Check for commands
  if (content.startsWith('/')) {
    await handleCommand(content);
    state.isLoading = false;
    elements.sendBtn.disabled = false;
    elements.messageInput.focus();
    return;
  }

  // Add user message optimistically
  state.messages.push({ role: 'user', content: content });
  renderMessages();
  scrollToBottom();

  // Show typing indicator
  showTypingIndicator();

  try {
    let response = await sendMessage(state.currentSession.id, content);

    hideTypingIndicator();

    // Add assistant response
    state.messages.push({ role: 'assistant', content: response.content });
    renderMessages();
    scrollToBottom();
  } catch (error) {
    hideTypingIndicator();

    // Show error as assistant message
    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: `Error: ${error.message}` }],
    });
    renderMessages();
    scrollToBottom();
  }

  state.isLoading = false;
  elements.sendBtn.disabled = false;
  elements.messageInput.focus();
}

async function handleCommand(content) {
  let parts   = content.slice(1).split(/\s+/);
  let command = parts[0].toLowerCase();
  let args    = parts.slice(1).join(' ');

  switch (command) {
    case 'clear':
      await handleClearMessages();
      break;

    case 'help':
      state.messages.push({
        role:    'assistant',
        content: [{ type: 'text', text: 'Available commands:\n/clear - Clear all messages\n/help - Show this help' }],
      });
      renderMessages();
      scrollToBottom();
      break;

    default:
      state.messages.push({
        role:    'assistant',
        content: [{ type: 'text', text: `Unknown command: /${command}\nType /help for available commands.` }],
      });
      renderMessages();
      scrollToBottom();
  }
}

async function handleClearMessages() {
  if (!state.currentSession)
    return;

  try {
    await clearMessages(state.currentSession.id);
    state.messages = [];
    renderMessages();
  } catch (error) {
    console.error('Failed to clear messages:', error);
  }
}

// ============================================================================
// Modals
// ============================================================================

function showNewSessionModal() {
  // Populate agent select
  let options = '<option value="">Select an agent...</option>';

  if (state.agents.length === 0) {
    options += '<option value="" disabled>No agents configured</option>';
  } else {
    for (let agent of state.agents)
      options += `<option value="${agent.id}">${escapeHtml(agent.name)} (${agent.type})</option>`;
  }

  elements.agentSelect.innerHTML = options;
  elements.newSessionError.textContent = '';
  elements.newSessionForm.reset();
  elements.newSessionModal.style.display = 'flex';
}

function hideNewSessionModal() {
  elements.newSessionModal.style.display = 'none';
}

function showNewAgentModal() {
  elements.newAgentError.textContent = '';
  elements.newAgentForm.reset();
  populateAgentProcesses();
  elements.newAgentModal.style.display = 'flex';
}

function hideNewAgentModal() {
  elements.newAgentModal.style.display = 'none';
}

async function handleCreateSession(e) {
  e.preventDefault();

  let name         = document.getElementById('session-name').value.trim();
  let agentId      = parseInt(elements.agentSelect.value, 10);
  let systemPrompt = document.getElementById('system-prompt').value.trim();

  if (!name || !agentId) {
    elements.newSessionError.textContent = 'Please fill in all required fields';
    return;
  }

  try {
    let session = await createSession(name, agentId, systemPrompt || null);
    hideNewSessionModal();
    navigate(`/sessions/${session.id}`);
  } catch (error) {
    elements.newSessionError.textContent = error.message;
  }
}

async function handleCreateAgent(e) {
  e.preventDefault();

  let name   = document.getElementById('agent-name').value.trim();
  let type   = document.getElementById('agent-type').value;
  let apiKey = document.getElementById('agent-api-key').value;
  let apiUrl = document.getElementById('agent-api-url').value.trim() || null;

  // Collect selected processes
  let defaultProcesses = Array.from(
    elements.agentProcessesList.querySelectorAll('input[name="defaultProcesses"]:checked')
  ).map((cb) => cb.value);

  if (!name || !type || !apiKey) {
    elements.newAgentError.textContent = 'Please fill in all required fields';
    return;
  }

  try {
    await createAgent(name, type, apiKey, apiUrl, defaultProcesses);
    state.agents = await fetchAgents();
    hideNewAgentModal();

    // If we were showing the "no agents" message, refresh
    if (state.sessions.length === 0)
      renderSessionsList();

    // Show the new session modal
    showNewSessionModal();
  } catch (error) {
    elements.newAgentError.textContent = error.message;
  }
}

// ============================================================================
// Auth
// ============================================================================

async function handleLogin(e) {
  e.preventDefault();

  let username = document.getElementById('username').value;
  let password = document.getElementById('password').value;

  elements.loginError.textContent = '';

  try {
    await login(username, password);
    navigate('/');
  } catch (error) {
    elements.loginError.textContent = error.message;
  }
}

async function handleLogout() {
  try {
    await logout();
    disconnectWebSocket();
    state.user     = null;
    state.sessions = [];
    state.agents   = [];
    navigate('/login');
  } catch (error) {
    console.error('Logout failed:', error);
  }
}

// ============================================================================
// WebSocket
// ============================================================================

function connectWebSocket() {
  if (state.ws && state.ws.readyState === WebSocket.OPEN)
    return;

  // Get auth token from cookie
  let token = document.cookie.split('; ')
    .find((c) => c.startsWith('token='))
    ?.split('=')[1];

  if (!token)
    return;

  let protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  let wsUrl    = `${protocol}//${window.location.host}${BASE_PATH}/ws?token=${token}`;

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    console.log('WebSocket connected');
  };

  state.ws.onmessage = (event) => {
    try {
      let message = JSON.parse(event.data);
      handleWebSocketMessage(message);
    } catch (e) {
      console.error('WebSocket message parse error:', e);
    }
  };

  state.ws.onclose = () => {
    console.log('WebSocket disconnected');
    state.ws = null;

    // Attempt reconnect after delay (if still authenticated)
    if (state.user)
      setTimeout(connectWebSocket, 5000);
  };

  state.ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

function disconnectWebSocket() {
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
}

function handleWebSocketMessage(message) {
  switch (message.type) {
    case 'running_commands':
      state.runningOperations = message.commands;
      renderOperationsPanel();
      break;

    case 'command_update':
      updateOperationState(message.command);
      break;

    case 'abort_result':
      // Handled by UI update from command_update
      break;

    case 'assertion_new':
      handleAssertionNew(message);
      break;

    case 'assertion_update':
      handleAssertionUpdate(message);
      break;

    case 'question_prompt':
      handleQuestionPrompt(message);
      break;

    case 'message_append':
      handleMessageAppend(message);
      break;
  }
}

function handleAssertionNew(message) {
  let { messageId, assertion } = message;

  if (!state.assertions[messageId])
    state.assertions[messageId] = [];

  state.assertions[messageId].push(assertion);
  updateAssertionUI(messageId, assertion.id);
}

function handleAssertionUpdate(message) {
  let { messageId, assertionId, status, preview, result } = message;

  if (!state.assertions[messageId])
    return;

  let assertion = state.assertions[messageId].find((a) => a.id === assertionId);
  if (!assertion)
    return;

  if (status !== undefined)
    assertion.status = status;

  if (preview !== undefined)
    assertion.preview = preview;

  if (result !== undefined)
    assertion.result = result;

  updateAssertionUI(messageId, assertionId);
}

function handleQuestionPrompt(message) {
  let { messageId, assertionId, question, options } = message;

  if (!state.assertions[messageId])
    state.assertions[messageId] = [];

  // Find or create the question assertion
  let assertion = state.assertions[messageId].find((a) => a.id === assertionId);
  if (!assertion) {
    assertion = {
      id:        assertionId,
      assertion: 'question',
      name:      'ask_user',
      message:   question,
      options:   options || [],
      status:    'waiting',
    };
    state.assertions[messageId].push(assertion);
  } else {
    assertion.message = question;
    assertion.options = options || [];
    assertion.status  = 'waiting';
  }

  updateAssertionUI(messageId, assertionId);
  scrollToBottom();
}

function handleMessageAppend(message) {
  let { messageId, content } = message;

  // Find the message in state
  let msg = state.messages.find((m) => m.id === messageId);
  if (!msg)
    return;

  // Append content
  if (typeof msg.content === 'string') {
    msg.content += content;
  } else if (Array.isArray(msg.content)) {
    let lastBlock = msg.content[msg.content.length - 1];
    if (lastBlock && lastBlock.type === 'text') {
      lastBlock.text += content;
    } else {
      msg.content.push({ type: 'text', text: content });
    }
  }

  // Update the message in the DOM
  let msgEl = document.querySelector(`[data-message-id="${messageId}"] .message-content`);
  if (msgEl)
    msgEl.textContent = typeof msg.content === 'string' ? msg.content : msg.content.find((b) => b.type === 'text')?.text || '';
}

function updateAssertionUI(messageId, assertionId) {
  // Find the message element
  let msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!msgEl)
    return;

  let bubble = msgEl.querySelector('.message-bubble');
  if (!bubble)
    return;

  // Find or create the assertion element
  let assertionEl = bubble.querySelector(`[data-assertion-id="${assertionId}"]`);
  let assertion   = state.assertions[messageId]?.find((a) => a.id === assertionId);

  if (!assertion)
    return;

  let newHtml = renderAssertionBlock(assertion);

  if (assertionEl) {
    assertionEl.outerHTML = newHtml;
  } else {
    bubble.insertAdjacentHTML('beforeend', newHtml);
  }

  // Re-attach event listeners for questions
  attachQuestionListeners(messageId, assertionId);
}

function attachQuestionListeners(messageId, assertionId) {
  // Option buttons
  document.querySelectorAll(`.question-option[data-assertion-id="${assertionId}"]`).forEach((btn) => {
    btn.onclick = () => submitQuestionAnswer(assertionId, btn.dataset.answer);
  });

  // Submit button
  let submitBtn = document.querySelector(`.question-submit[data-assertion-id="${assertionId}"]`);
  if (submitBtn) {
    submitBtn.onclick = () => {
      let input = document.querySelector(`.question-input[data-assertion-id="${assertionId}"]`);
      if (input && input.value.trim())
        submitQuestionAnswer(assertionId, input.value.trim());
    };
  }

  // Enter key on input
  let input = document.querySelector(`.question-input[data-assertion-id="${assertionId}"]`);
  if (input) {
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        e.preventDefault();
        submitQuestionAnswer(assertionId, input.value.trim());
      }
    };
  }
}

function submitQuestionAnswer(assertionId, answer) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({
      type:        'question_answer',
      assertionId: assertionId,
      answer:      answer,
    }));
  }

  // Update the local assertion state
  for (let msgId in state.assertions) {
    let assertion = state.assertions[msgId].find((a) => a.id === assertionId);
    if (assertion) {
      assertion.status = 'completed';
      assertion.answer = answer;
      updateAssertionUI(msgId, assertionId);
      break;
    }
  }
}

function updateOperationState(command) {
  let index = state.runningOperations.findIndex((op) => op.id === command.id);

  if (index >= 0) {
    if (command.status === 'completed' || command.status === 'failed' || command.status === 'aborted') {
      // Remove completed operations after a delay
      state.runningOperations[index] = command;
      renderOperationsPanel();

      setTimeout(() => {
        state.runningOperations = state.runningOperations.filter((op) => op.id !== command.id);
        renderOperationsPanel();
      }, 3000);
    } else {
      state.runningOperations[index] = command;
      renderOperationsPanel();
    }
  } else if (command.status === 'pending' || command.status === 'running') {
    state.runningOperations.push(command);
    renderOperationsPanel();
  }
}

function abortOperation(commandId) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'abort', commandId: commandId }));
  }
}

function renderOperationsPanel() {
  if (state.runningOperations.length === 0) {
    elements.operationsPanel.style.display = 'none';
    return;
  }

  elements.operationsPanel.style.display = 'block';

  let html = state.runningOperations.map((op) => `
    <div class="operation-item">
      <div class="operation-info">
        <div class="operation-command">${escapeHtml(op.command)}</div>
        <div class="operation-status ${op.status}">${op.status}</div>
      </div>
      ${(op.status === 'pending' || op.status === 'running')
        ? `<button class="btn operation-abort" onclick="abortOperation('${op.id}')">Abort</button>`
        : ''}
    </div>
  `).join('');

  elements.operationsList.innerHTML = html;
}

// ============================================================================
// Processes
// ============================================================================

async function loadProcesses() {
  try {
    let data = await fetchProcesses();
    state.processes.system = data.system || [];
    state.processes.user   = data.user || [];
  } catch (error) {
    console.error('Failed to load processes:', error);
  }
}

function showProcessesModal() {
  loadProcesses().then(() => {
    renderSystemProcesses();
    renderUserProcesses();
    elements.processesModal.style.display = 'flex';
  });
}

function hideProcessesModal() {
  elements.processesModal.style.display = 'none';
}

function renderSystemProcesses() {
  if (state.processes.system.length === 0) {
    elements.systemProcessesList.innerHTML = '<div class="empty-state">No system processes available.</div>';
    return;
  }

  let html = state.processes.system.map((p) => `
    <div class="process-item">
      <div class="process-info">
        <div class="process-name">${escapeHtml(p.name)}</div>
        <div class="process-description">${escapeHtml(p.description || 'No description')}</div>
      </div>
    </div>
  `).join('');

  elements.systemProcessesList.innerHTML = html;
}

function renderUserProcesses() {
  if (state.processes.user.length === 0) {
    elements.userProcessesList.innerHTML = '<div class="empty-state">No custom processes yet. Create one to get started.</div>';
    return;
  }

  let html = state.processes.user.map((p) => `
    <div class="process-item">
      <div class="process-info">
        <div class="process-name">${escapeHtml(p.name)}</div>
        <div class="process-description">${escapeHtml(p.description || 'No description')}</div>
      </div>
      <div class="process-actions">
        <button class="btn btn-secondary" onclick="editProcess(${p.id})">Edit</button>
        <button class="btn btn-secondary" onclick="confirmDeleteProcess(${p.id}, '${escapeHtml(p.name)}')">Delete</button>
      </div>
    </div>
  `).join('');

  elements.userProcessesList.innerHTML = html;
}

function showNewProcessModal() {
  state.editingProcessId = null;
  elements.editProcessTitle.textContent = 'New Process';
  elements.editProcessForm.reset();
  elements.editProcessError.textContent = '';
  elements.editProcessModal.style.display = 'flex';
}

function hideEditProcessModal() {
  elements.editProcessModal.style.display = 'none';
  state.editingProcessId = null;
}

async function editProcess(id) {
  try {
    let process = await fetchProcess(id);
    state.editingProcessId = id;
    elements.editProcessTitle.textContent = 'Edit Process';
    document.getElementById('process-name').value        = process.name;
    document.getElementById('process-description').value = process.description || '';
    document.getElementById('process-content').value     = process.content;
    elements.editProcessError.textContent = '';
    elements.editProcessModal.style.display = 'flex';
  } catch (error) {
    console.error('Failed to load process:', error);
  }
}

async function handleSaveProcess(e) {
  e.preventDefault();

  let name        = document.getElementById('process-name').value.trim();
  let description = document.getElementById('process-description').value.trim() || null;
  let content     = document.getElementById('process-content').value;

  // Validate name format
  if (!/^[a-z0-9_]+$/.test(name)) {
    elements.editProcessError.textContent = 'Name must contain only lowercase letters, numbers, and underscores';
    return;
  }

  try {
    if (state.editingProcessId) {
      await updateProcess(state.editingProcessId, name, description, content);
    } else {
      await createProcess(name, description, content);
    }

    hideEditProcessModal();
    await loadProcesses();
    renderUserProcesses();
  } catch (error) {
    elements.editProcessError.textContent = error.message;
  }
}

async function confirmDeleteProcess(id, name) {
  if (!confirm(`Delete process "${name}"?`))
    return;

  try {
    await deleteProcess(id);
    await loadProcesses();
    renderUserProcesses();
  } catch (error) {
    console.error('Failed to delete process:', error);
  }
}

function switchProcessTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  document.querySelectorAll('.tab-content').forEach((content) => {
    content.classList.toggle('active', content.id === `processes-tab-${tab}`);
  });
}

async function populateAgentProcesses() {
  await loadProcesses();

  let allProcesses = [
    ...state.processes.system.map((p) => ({ ...p, type: 'system' })),
    ...state.processes.user.map((p) => ({ ...p, type: 'user' })),
  ];

  if (allProcesses.length === 0) {
    elements.agentProcessesList.innerHTML = '<div class="empty-state">No processes available.</div>';
    return;
  }

  let html = allProcesses.map((p) => `
    <label class="checkbox-item">
      <input type="checkbox" name="defaultProcesses" value="${escapeHtml(p.name)}">
      <span>${escapeHtml(p.name)}</span>
      <span class="process-type">${p.type}</span>
    </label>
  `).join('');

  elements.agentProcessesList.innerHTML = html;
}

// ============================================================================
// Agents Modal & Config
// ============================================================================

function showAgentsModal() {
  renderAgentsList();
  elements.agentsModal.style.display = 'flex';
}

function hideAgentsModal() {
  elements.agentsModal.style.display = 'none';
}

function renderAgentsList() {
  if (state.agents.length === 0) {
    elements.agentsList.innerHTML = '<div class="empty-state">No agents configured yet.</div>';
    return;
  }

  let html = state.agents.map((agent) => `
    <div class="agent-item">
      <div class="agent-info">
        <div class="agent-name">${escapeHtml(agent.name)}</div>
        <div class="agent-type">${escapeHtml(agent.type)}</div>
      </div>
      <div class="agent-actions">
        <button class="btn btn-secondary btn-sm" onclick="showAgentConfigModal(${agent.id})">Config</button>
        <button class="btn btn-secondary btn-sm" onclick="confirmDeleteAgent(${agent.id}, '${escapeHtml(agent.name)}')">Delete</button>
      </div>
    </div>
  `).join('');

  elements.agentsList.innerHTML = html;
}

async function showAgentConfigModal(agentId) {
  try {
    let config = await fetchAgentConfig(agentId);
    elements.agentConfigId.value   = agentId;
    elements.agentConfigJson.value = JSON.stringify(config, null, 2);
    elements.agentConfigError.textContent = '';
    elements.agentConfigModal.style.display = 'flex';
  } catch (error) {
    console.error('Failed to load agent config:', error);
  }
}

function hideAgentConfigModal() {
  elements.agentConfigModal.style.display = 'none';
}

async function handleSaveAgentConfig(e) {
  e.preventDefault();

  let agentId   = elements.agentConfigId.value;
  let jsonValue = elements.agentConfigJson.value.trim();

  // Validate JSON
  let config;
  try {
    config = JSON.parse(jsonValue);
  } catch (error) {
    elements.agentConfigError.textContent = 'Invalid JSON: ' + error.message;
    return;
  }

  // Ensure it's an object
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    elements.agentConfigError.textContent = 'Config must be a JSON object';
    return;
  }

  try {
    await updateAgentConfig(agentId, config);
    hideAgentConfigModal();
  } catch (error) {
    elements.agentConfigError.textContent = error.message;
  }
}

async function confirmDeleteAgent(agentId, name) {
  if (!confirm(`Delete agent "${name}"? This cannot be undone.`))
    return;

  try {
    await deleteAgent(agentId);
    state.agents = await fetchAgents();
    renderAgentsList();
    renderSessionsList();  // Update in case agent was in use
  } catch (error) {
    console.error('Failed to delete agent:', error);
  }
}

// ============================================================================
// Utilities
// ============================================================================

function escapeHtml(text) {
  let div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function autoResizeTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
}

// ============================================================================
// Event Listeners
// ============================================================================

// Login
elements.loginForm.addEventListener('submit', handleLogin);

// Sessions
elements.newSessionBtn.addEventListener('click', () => {
  if (state.agents.length === 0)
    showNewAgentModal();
  else
    showNewSessionModal();
});
elements.logoutBtn.addEventListener('click', handleLogout);

// Chat
elements.sendBtn.addEventListener('click', handleSendMessage);
elements.messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendMessage();
  }
});
elements.messageInput.addEventListener('input', () => {
  autoResizeTextarea(elements.messageInput);
});
elements.clearBtn.addEventListener('click', handleClearMessages);
elements.backBtn.addEventListener('click', () => navigate('/'));
elements.chatLogoutBtn.addEventListener('click', handleLogout);
elements.sessionSelect.addEventListener('change', () => {
  let sessionId = elements.sessionSelect.value;

  if (sessionId)
    navigate(`/sessions/${sessionId}`);
});

// Modals
elements.newSessionForm.addEventListener('submit', handleCreateSession);
elements.cancelNewSession.addEventListener('click', hideNewSessionModal);
elements.newAgentForm.addEventListener('submit', handleCreateAgent);
elements.cancelNewAgent.addEventListener('click', hideNewAgentModal);

// Close modals on overlay click
elements.newSessionModal.addEventListener('click', (e) => {
  if (e.target === elements.newSessionModal)
    hideNewSessionModal();
});
elements.newAgentModal.addEventListener('click', (e) => {
  if (e.target === elements.newAgentModal)
    hideNewAgentModal();
});

// Processes
elements.processesBtn.addEventListener('click', showProcessesModal);
elements.closeProcessesModal.addEventListener('click', hideProcessesModal);
elements.processesModal.addEventListener('click', (e) => {
  if (e.target === elements.processesModal)
    hideProcessesModal();
});
elements.newProcessBtn.addEventListener('click', showNewProcessModal);

// Processes tab switching
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchProcessTab(btn.dataset.tab));
});

// Edit Process Modal
elements.editProcessForm.addEventListener('submit', handleSaveProcess);
elements.cancelEditProcess.addEventListener('click', hideEditProcessModal);
elements.editProcessModal.addEventListener('click', (e) => {
  if (e.target === elements.editProcessModal)
    hideEditProcessModal();
});

// Agents Modal
elements.agentsBtn.addEventListener('click', showAgentsModal);
elements.closeAgentsModal.addEventListener('click', hideAgentsModal);
elements.addAgentFromList.addEventListener('click', () => {
  hideAgentsModal();
  showNewAgentModal();
});
elements.agentsModal.addEventListener('click', (e) => {
  if (e.target === elements.agentsModal)
    hideAgentsModal();
});

// Agent Config Modal
elements.agentConfigForm.addEventListener('submit', handleSaveAgentConfig);
elements.cancelAgentConfig.addEventListener('click', hideAgentConfigModal);
elements.agentConfigModal.addEventListener('click', (e) => {
  if (e.target === elements.agentConfigModal)
    hideAgentConfigModal();
});

// Operations panel toggle
elements.toggleOperations.addEventListener('click', () => {
  let list = elements.operationsList;

  if (list.style.display === 'none') {
    list.style.display = 'block';
    elements.toggleOperations.innerHTML = '&#8722;';
  } else {
    list.style.display = 'none';
    elements.toggleOperations.innerHTML = '+';
  }
});

// Browser navigation
window.addEventListener('popstate', handleRoute);

// ============================================================================
// Initialize
// ============================================================================

handleRoute();
