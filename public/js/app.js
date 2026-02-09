'use strict';

// ============================================================================
// System Message Helper
// ============================================================================

/**
 * Display a system message to the user (shown as assistant message).
 * Consolidates the common pattern of push + render + scroll.
 * @param {string} text - Message text to display
 */
function showSystemMessage(text) {
  state.messages.push({
    role:    'assistant',
    content: [{ type: 'text', text }],
  });
  renderMessages();
  forceScrollToBottom();
}

// ============================================================================
// Cost Display Functions
// ============================================================================
// Note: formatTokenCount, calculateCost, formatCost are in utils.js

/**
 * Update the header cost displays (global, service, and session).
 */
function updateCostDisplay() {
  // Update global cost in sessions view
  let globalCostSessions = document.getElementById('global-cost-sessions');
  if (globalCostSessions) {
    globalCostSessions.textContent = formatCost(state.globalSpend.cost);
  }

  // Update all costs in chat view
  let globalCostChat = document.getElementById('global-cost-chat');
  if (globalCostChat) {
    globalCostChat.textContent = formatCost(state.globalSpend.cost);
  }

  let serviceCostChat = document.getElementById('service-cost-chat');
  if (serviceCostChat) {
    serviceCostChat.textContent = formatCost(state.serviceSpend.cost);
  }

  let sessionCostChat = document.getElementById('session-cost-chat');
  if (sessionCostChat) {
    sessionCostChat.textContent = formatCost(state.sessionSpend.cost);
  }
}

/**
 * Fetch and update global usage (for sessions list view).
 */
async function loadGlobalUsage() {
  try {
    let usage = await fetchUsage();
    state.globalSpend = { cost: usage.global?.cost || 0 };
    updateCostDisplay();
  } catch (error) {
    console.error('Failed to fetch global usage:', error);
  }
}

/**
 * Fetch and update session usage (for chat view).
 */
async function loadSessionUsage(sessionId) {
  try {
    let usage = await fetchSessionUsage(sessionId);
    state.globalSpend = { cost: usage.global?.cost || 0 };
    state.serviceSpend = { cost: usage.service?.cost || 0 };
    state.sessionSpend = { cost: usage.session?.cost || 0 };
    updateCostDisplay();
  } catch (error) {
    console.error('Failed to fetch session usage:', error);
  }
}

/**
 * Reset session cost tracking.
 */
function resetSessionCost() {
  state.sessionSpend = { cost: 0 };
  updateCostDisplay();
}

// ============================================================================
// Chat
// ============================================================================

async function loadSession(sessionId) {
  try {
    let session    = await fetchSession(sessionId);
    state.currentSession = session;
    state.messages       = session.messages || [];

    // Load session usage (global, service, and session spend)
    await loadSessionUsage(sessionId);

    // Legacy: also check session.cost for backwards compatibility
    if (!state.sessionSpend.cost && session.cost) {
      let legacyCost = calculateCost(session.cost.inputTokens || 0, session.cost.outputTokens || 0);
      state.sessionSpend.cost += legacyCost;
      updateCostDisplay();
    }

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

// ============================================================================
// Debounced Render System
// ============================================================================
// Prevents infinite render loops by debouncing rapid render calls.
// Uses both a debounce delay AND a max wait time to ensure responsiveness.

let renderDebounceTimer = null;
let renderMaxWaitTimer = null;
let renderPending = false;
const RENDER_DEBOUNCE_MS = 16;   // ~1 frame at 60fps
const RENDER_MAX_WAIT_MS = 100;  // Max time before forced render

/**
 * The actual render implementation.
 * @private
 */
function renderMessagesImpl() {
  renderPending = false;

  // Clear timers
  if (renderDebounceTimer) {
    clearTimeout(renderDebounceTimer);
    renderDebounceTimer = null;
  }
  if (renderMaxWaitTimer) {
    clearTimeout(renderMaxWaitTimer);
    renderMaxWaitTimer = null;
  }

  // Use hero-chat component if available
  if (elements.heroChat && typeof elements.heroChat.setMessages === 'function') {
    // Set the show hidden state
    if (state.showHiddenMessages !== elements.heroChat._showHiddenState) {
      elements.heroChat._showHiddenState = state.showHiddenMessages;
      if (state.showHiddenMessages) {
        elements.heroChat.toggleHiddenMessages();
      }
    }

    // Update messages via component
    elements.heroChat.setMessages(state.messages);

    // Set streaming state
    elements.heroChat.setStreaming(state.streamingMessage);

    // Attach event handlers for user prompt elements
    state.messages.forEach((message) => {
      if (message.id) {
        let messageElement = document.getElementById(`message-${message.id}`);
        if (messageElement) {
          attachUserPromptHandlers(messageElement, message.id);
        }
      }
    });

    return;
  }

  // Fallback: legacy DOM rendering
  // Preserve streaming message element if it exists (not in state.messages yet)
  let streamingEl = document.getElementById('streaming-message');
  if (streamingEl) {
    streamingEl.remove();  // Detach from DOM temporarily
  }

  // Filter messages based on showHiddenMessages toggle
  let visibleMessages = state.showHiddenMessages
    ? state.messages  // Show all messages including hidden ones
    : state.messages.filter((message) => !message.hidden);

  let html = visibleMessages.map((message) => renderMessage(message)).join('');
  elements.messagesContainer.innerHTML = html;

  // Re-attach streaming message element if it was preserved
  if (streamingEl) {
    elements.messagesContainer.appendChild(streamingEl);
  }

  // Attach event handlers for user prompt elements
  visibleMessages.forEach((message) => {
    if (message.id) {
      let messageElement = document.getElementById(`message-${message.id}`);
      if (messageElement) {
        attachUserPromptHandlers(messageElement, message.id);
      }
    }
  });

  scrollToBottom();
}

/**
 * Debounced render function.
 * Batches rapid render calls to prevent infinite loops.
 * Guarantees render within RENDER_MAX_WAIT_MS even if calls keep coming.
 */
function renderMessages() {
  // Clear existing debounce timer
  if (renderDebounceTimer) {
    clearTimeout(renderDebounceTimer);
  }

  // Set up max wait timer if this is the first pending render
  if (!renderPending) {
    renderPending = true;
    renderMaxWaitTimer = setTimeout(() => {
      console.log('[Render] Max wait reached, forcing render');
      renderMessagesImpl();
    }, RENDER_MAX_WAIT_MS);
  }

  // Set up debounce timer
  renderDebounceTimer = setTimeout(() => {
    renderMessagesImpl();
  }, RENDER_DEBOUNCE_MS);
}

function renderMessage(message) {
  let roleClass   = (message.role === 'user') ? 'message-user' : 'message-assistant';
  let agentName   = state.currentSession?.agent?.name || 'Assistant';
  let roleLabel   = (message.role === 'user') ? 'You' : agentName;
  let messageId   = message.id || '';
  let queuedClass = (message.queued) ? ' message-queued' : '';
  let queuedBadge = (message.queued) ? '<span class="queued-badge">Queued</span>' : '';
  let hiddenClass = (message.hidden) ? ' message-hidden' : '';
  let errorClass  = (message.type === 'error') ? ' message-error' : '';
  let typeBadge   = '';

  // Add type badge for hidden messages
  if (message.hidden && message.type) {
    let typeLabels = {
      system:      'System',
      interaction: 'Interaction',
      feedback:    'Feedback',
    };
    let label = typeLabels[message.type] || message.type;
    typeBadge = `<span class="type-badge type-${message.type}">${label}</span>`;
  }

  let contentHtml = '';

  // Handle error messages specially
  if (message.type === 'error') {
    let errorText = (typeof message.content === 'string') ? message.content : 'An error occurred';
    contentHtml = `
      <div class="streaming-error">
        <span class="error-icon">⚠</span>
        <span class="error-text">${escapeHtml(errorText)}</span>
      </div>
    `;
  } else if (typeof message.content === 'string') {
    contentHtml = `<div class="message-content">${renderMarkup(message.content)}</div>`;
  } else if (Array.isArray(message.content)) {
    for (let block of message.content) {
      if (block.type === 'text') {
        contentHtml += `<div class="message-content">${renderMarkup(block.text)}</div>`;
      } else if (block.type === 'tool_use') {
        contentHtml += renderToolUse(block);
      } else if (block.type === 'tool_result') {
        contentHtml += renderToolResult(block);
      }
    }
  }

  // Add assertion blocks for this message
  let assertionsHtml = (messageId) ? renderAssertionsForMessage(messageId) : '';

  // Calculate token estimate from content
  let tokenEstimate = 0;
  if (typeof message.content === 'string') {
    tokenEstimate = Math.ceil(message.content.length / 4);
  } else if (Array.isArray(message.content)) {
    for (let block of message.content) {
      if (block.type === 'text') {
        tokenEstimate += Math.ceil(block.text.length / 4);
      }
    }
  }

  // Format timestamp with token count
  let timestampHtml = '';
  if (message.createdAt) {
    let timeStr  = formatRelativeDate(message.createdAt);
    let tokenStr = formatTokenCount(tokenEstimate);
    timestampHtml = `<div class="message-timestamp">${timeStr} · ~${tokenStr} tokens</div>`;
  } else if (tokenEstimate > 0) {
    let tokenStr = formatTokenCount(tokenEstimate);
    timestampHtml = `<div class="message-timestamp">~${tokenStr} tokens</div>`;
  }

  return `
    <div class="message ${roleClass}${queuedClass}${hiddenClass}${errorClass}" data-message-id="${messageId}">
      <div class="message-header">${roleLabel} ${queuedBadge}${typeBadge}</div>
      <div class="message-bubble">
        ${contentHtml}
        ${assertionsHtml}
      </div>
      ${timestampHtml}
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

  if (type === 'link')
    return renderLinkElement(assertion);

  if (type === 'todo')
    return renderTodoElement(assertion);

  if (type === 'progress')
    return renderProgressElement(assertion);

  // Default: command assertion
  return `
    <div class="assertion-block assertion-${type}" data-assertion-id="${id}">
      <div class="assertion-header">
        <span class="assertion-type">${escapeHtml(type)}</span>
        <span class="assertion-name">${escapeHtml(name)}</span>
        <span class="assertion-status ${status}">${status}</span>
      </div>
      ${(preview) ? `<div class="assertion-preview"><pre>${escapeHtml(preview)}</pre></div>` : ''}
      ${(result) ? `<div class="assertion-result"><pre>${escapeHtml((typeof result === 'string') ? result : JSON.stringify(result, null, 2))}</pre></div>` : ''}
    </div>
  `;
}

function renderThinkingAssertion(assertion) {
  let { id, name, message, status } = assertion;
  let isRunning = (status === 'running' || status === 'pending' || !status);

  return `
    <div class="assertion-block thinking" data-assertion-id="${id}">
      ${(isRunning) ? `
        <div class="thinking-indicator">
          <span></span><span></span><span></span>
        </div>
      ` : ''}
      <span class="thinking-text">${escapeHtml(message || name || 'Processing...')}</span>
    </div>
  `;
}

function renderQuestionAssertion(assertion) {
  let { id, name, message, options, status, answer, mode, timeout } = assertion;
  mode = mode || 'demand';

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
      `<button class="button button-secondary question-option" data-assertion-id="${id}" data-answer="${escapeHtml(String(opt))}">${escapeHtml(String(opt))}</button>`
    ).join('');
  }

  let modeClass   = (mode === 'demand') ? 'question-demand' : 'question-timeout';
  let modeLabel   = (mode === 'demand') ? 'Required' : `Optional (${Math.round(timeout / 1000)}s)`;
  let placeholder = (mode === 'demand') ? 'Your response is required...' : 'Type your answer (optional)...';

  return `
    <div class="assertion-block question ${modeClass}" data-assertion-id="${id}" data-mode="${mode}" tabindex="0">
      <div class="question-header">
        <span class="question-mode-label ${mode}">${modeLabel}</span>
      </div>
      <div class="question-text">${escapeHtml(message)}</div>
      <div class="question-actions">
        ${optionsHtml}
        <input type="text" class="question-input" placeholder="${placeholder}" data-assertion-id="${id}" data-mode="${mode}" tabindex="0">
        <button class="button button-primary question-submit" data-assertion-id="${id}">Submit</button>
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

// Ability approval UI moved to approvals.js

// Streaming message processing moved to streaming.js

// Command handlers moved to commands.js

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

  let protocol = (window.location.protocol === 'https:') ? 'wss:' : 'ws:';
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

    // Element message types
    case 'element_new':
      handleElementNew(message);
      break;

    case 'element_update':
      handleElementUpdate(message);
      break;

    case 'todo_item_update':
      handleTodoItemUpdate(message);
      break;

    // Ability approval requests
    case 'ability_approval_request':
      handleAbilityApprovalRequest(message);
      break;

    case 'ability_approval_timeout':
      handleAbilityApprovalTimeout(message);
      break;

    // Ability questions
    case 'ability_question':
      handleAbilityQuestionRequest(message);
      break;

    case 'ability_question_timeout':
      handleAbilityQuestionTimeout(message);
      break;

    // New message from server (used for onstart flow and real-time sync)
    case 'new_message':
      handleNewMessage(message);
      break;
  }
}

/**
 * Handle a new message broadcast from the server.
 * This is used for the onstart flow and real-time message sync.
 */
function handleNewMessage(wsMessage) {
  let { sessionId, message } = wsMessage;

  debug('App', 'handleNewMessage', { sessionId, messageId: message.id, role: message.role, hidden: message.hidden });

  // Only handle if for current session
  if (!state.currentSession || state.currentSession.id !== parseInt(sessionId, 10))
    return;

  // Check if message already exists by ID
  let existingIndex = state.messages.findIndex((m) => m.id === message.id);
  if (existingIndex !== -1) {
    debug('App', 'Message already exists by ID, updating', { id: message.id });
    state.messages[existingIndex] = message;
    renderMessages();
    scrollToBottom();
    return;
  }

  // For user messages, check if we have an optimistic version (no ID, same content)
  if (message.role === 'user') {
    let optimisticIndex = state.messages.findIndex(
      (m) => !m.id && m.role === 'user' && m.content === message.content
    );
    if (optimisticIndex !== -1) {
      debug('App', 'Found optimistic user message, replacing', { content: message.content.slice(0, 50) });
      state.messages[optimisticIndex] = message;
      renderMessages();
      scrollToBottom();
      return;
    }
  }

  // For assistant messages, check if we're currently streaming and this is the finalized version
  if (message.role === 'assistant' && state.streamingMessage) {
    debug('App', 'Assistant message received while streaming, will be handled by finalize');
    // Don't add here - the streaming finalization will handle it
    return;
  }

  debug('App', 'Adding new message to state', { id: message.id, role: message.role });
  state.messages.push(message);

  // Re-render messages
  renderMessages();
  scrollToBottom();
}

function handleAbilityApprovalRequest(message) {
  let { executionId, sessionId, abilityName, description, params, dangerLevel, messageId } = message;

  // Only handle if for current session
  if (state.currentSession?.id !== sessionId)
    return;

  // Store in pending approvals
  state.pendingApprovals[executionId] = {
    executionId,
    abilityName,
    description,
    params,
    dangerLevel,
    messageId,
    status: 'pending',
  };

  // Append approval UI to the message or to the messages container
  let approvalHtml = renderAbilityApproval(state.pendingApprovals[executionId]);

  if (messageId) {
    let messageEl = document.querySelector(`[data-message-id="${messageId}"] .message-bubble`);
    if (messageEl)
      messageEl.insertAdjacentHTML('beforeend', approvalHtml);
    else
      elements.messagesContainer.insertAdjacentHTML('beforeend', approvalHtml);
  } else {
    elements.messagesContainer.insertAdjacentHTML('beforeend', approvalHtml);
  }

  scrollToBottom();
}

function handleAbilityApprovalTimeout(message) {
  let { executionId } = message;

  if (state.pendingApprovals[executionId]) {
    state.pendingApprovals[executionId].status = 'denied';
    updateAbilityApprovalUI(executionId);
  }
}

function handleAbilityQuestionRequest(message) {
  let { questionId, sessionId, prompt, type, options, defaultValue, timeout, messageId } = message;

  // Only handle if for current session
  if (state.currentSession?.id !== sessionId)
    return;

  // Store in pending questions
  state.pendingAbilityQs[questionId] = {
    questionId,
    prompt,
    type,
    options,
    defaultValue,
    timeout,
    messageId,
    status: 'pending',
  };

  // Append question UI
  let questionHtml = renderAbilityQuestion(state.pendingAbilityQs[questionId]);

  if (messageId) {
    let messageEl = document.querySelector(`[data-message-id="${messageId}"] .message-bubble`);
    if (messageEl)
      messageEl.insertAdjacentHTML('beforeend', questionHtml);
    else
      elements.messagesContainer.insertAdjacentHTML('beforeend', questionHtml);
  } else {
    elements.messagesContainer.insertAdjacentHTML('beforeend', questionHtml);
  }

  scrollToBottom();
}

function handleAbilityQuestionTimeout(message) {
  let { questionId, defaultValue } = message;

  if (state.pendingAbilityQs[questionId]) {
    state.pendingAbilityQs[questionId].status = 'answered';
    state.pendingAbilityQs[questionId].answer = defaultValue;
    updateAbilityQuestionUI(questionId);
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
  let { messageId, assertionId, question, options, mode, timeout } = message;
  mode = mode || 'demand';

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
      mode:      mode,
      timeout:   timeout || 0,
      default:   message.default,
      status:    'waiting',
    };
    state.assertions[messageId].push(assertion);
  } else {
    assertion.message = question;
    assertion.options = options || [];
    assertion.mode    = mode;
    assertion.timeout = timeout || 0;
    assertion.default = message.default;
    assertion.status  = 'waiting';
  }

  // Track demand questions for main input targeting
  if (mode === 'demand') {
    state.activeDemandQuestion = { messageId, assertionId };
  }

  updateAssertionUI(messageId, assertionId);
  scrollToBottom();

  // Focus the question input for demand questions
  if (mode === 'demand') {
    setTimeout(() => {
      let input = document.querySelector(`.question-input[data-assertion-id="${assertionId}"]`);
      if (input)
        input.focus();
    }, 100);
  }
}

function handleMessageAppend(message) {
  let { messageId, content } = message;

  // Find the message in state
  let foundMessage = state.messages.find((m) => m.id === messageId);
  if (!foundMessage)
    return;

  // Append content
  if (typeof foundMessage.content === 'string') {
    foundMessage.content += content;
  } else if (Array.isArray(foundMessage.content)) {
    let lastBlock = foundMessage.content[foundMessage.content.length - 1];
    if (lastBlock && lastBlock.type === 'text') {
      lastBlock.text += content;
    } else {
      foundMessage.content.push({ type: 'text', text: content });
    }
  }

  // Update the message in the DOM
  let messageElement = document.querySelector(`[data-message-id="${messageId}"] .message-content`);
  if (messageElement)
    messageElement.textContent = (typeof foundMessage.content === 'string') ? foundMessage.content : foundMessage.content.find((b) => b.type === 'text')?.text || '';
}

function handleElementNew(message) {
  let { messageId, element } = message;

  if (!state.assertions[messageId])
    state.assertions[messageId] = [];

  // Elements are stored as assertions
  state.assertions[messageId].push(element);
  updateAssertionUI(messageId, element.id);
}

function handleElementUpdate(message) {
  let { messageId, elementId, updates } = message;

  if (!state.assertions[messageId])
    return;

  let element = state.assertions[messageId].find((a) => a.id === elementId);
  if (!element)
    return;

  // Apply updates
  Object.assign(element, updates);
  updateAssertionUI(messageId, elementId);
}

function handleTodoItemUpdate(message) {
  let { messageId, elementId, itemId, status } = message;

  if (!state.assertions[messageId])
    return;

  let todoElement = state.assertions[messageId].find((a) => a.id === elementId);
  if (!todoElement || !todoElement.items)
    return;

  let item = todoElement.items.find((i) => i.id === itemId);
  if (item) {
    item.status = status;
    updateAssertionUI(messageId, elementId);
  }
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
  document.querySelectorAll(`.question-option[data-assertion-id="${assertionId}"]`).forEach((button) => {
    button.onclick = () => submitQuestionAnswer(assertionId, button.dataset.answer);
  });

  // Submit button
  let submitButton = document.querySelector(`.question-submit[data-assertion-id="${assertionId}"]`);
  if (submitButton) {
    submitButton.onclick = () => {
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

      // Clear active demand question if this was it
      if (state.activeDemandQuestion?.assertionId === assertionId)
        state.activeDemandQuestion = null;

      break;
    }
  }
}

/**
 * Submit an answer to a user_prompt element.
 * Creates a new user message with the answer and an interaction to update the prompt.
 */
function submitUserPromptAnswer(messageId, promptId, question, answer) {
  console.log('[App] submitUserPromptAnswer called:', { messageId, promptId, question, answer });

  // Update the message content in state.messages so re-renders preserve the answered state
  updatePromptInState(messageId, promptId, answer);

  // Create message content with interaction
  let interactionPayload = {
    interaction_id:  `prompt-response-${promptId}`,
    target_id:       '@system',
    target_property: 'update_prompt',
    payload: {
      message_id: messageId,
      prompt_id:  promptId,
      answer:     answer,
    },
  };

  let content = `Answering "${question}":\n\n${answer}\n\n<interaction>\n${JSON.stringify(interactionPayload, null, 2)}\n</interaction>`;

  console.log('[App] Sending message with interaction:', content);

  // Send as new user message
  if (state.streamingMode) {
    processMessageStream(content);
  } else {
    processMessage(content);
  }
}

/**
 * Update a prompt's answered state in state.messages so re-renders preserve it.
 */
function updatePromptInState(messageId, promptId, answer) {
  console.log('[App] updatePromptInState:', { messageId, promptId, answer });

  // Find the message in state
  let message = state.messages.find((m) => m.id === messageId || m.id === String(messageId));

  if (!message) {
    console.log('[App] Message not found in state for ID:', messageId);
    return;
  }

  // Escape the answer for XML
  let escapedAnswer = answer
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Update the content - find the hml-prompt by ID and add answered attribute + response
  let pattern = new RegExp(
    `(<hml-prompt\\s+id=["']${promptId}["'][^>]*)>([\\s\\S]*?)</hml-prompt>`,
    'gi'
  );

  let updatedContent = message.content.replace(
    pattern,
    (match, openTag, content) => {
      // Remove any existing answered attribute before adding the new one
      let cleanedTag = openTag.replace(/\s+answered=["'][^"']*["']/gi, '');
      // Remove any existing <response> element from content
      let cleanedContent = content.replace(/<response>[\s\S]*?<\/response>/gi, '').trim();
      return `${cleanedTag} answered="true">${cleanedContent}<response>${escapedAnswer}</response></hml-prompt>`;
    }
  );

  if (updatedContent !== message.content) {
    message.content = updatedContent;
    console.log('[App] Updated message content in state');
  } else {
    console.log('[App] Pattern did not match, content unchanged');
  }
}

/**
 * Update the UI for a user_prompt element to show the answered state.
 * @deprecated Use updatePromptInState instead - this targets old-style prompts
 */
function updateUserPromptUI(promptId, answer) {
  let promptElement = document.querySelector(`.hml-user-prompt[data-prompt-id="${promptId}"]`);

  if (!promptElement) return;

  let question = promptElement.querySelector('.hml-user-prompt-question')?.textContent || '';

  promptElement.classList.add('answered');
  promptElement.innerHTML = `
    <div class="hml-user-prompt-question">${escapeHtmlForPrompt(question)}</div>
    <div class="hml-user-prompt-response">${escapeHtmlForPrompt(answer)}</div>
  `;
}

/**
 * Escape HTML for user prompt display.
 */
function escapeHtmlForPrompt(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Make submitUserPromptAnswer available globally (called from markup.js)
window.submitUserPromptAnswer = submitUserPromptAnswer;

// Listen for prompt-submit events from <hml-prompt> Web Components
document.addEventListener('prompt-submit', (event) => {
  console.log('[App] prompt-submit event received:', event.detail);
  let { messageId, promptId, question, answer } = event.detail;
  submitUserPromptAnswer(messageId, promptId, question, answer);
});

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
        ? `<button class="button operation-abort" onclick="abortOperation('${op.id}')">Abort</button>`
        : ''}
    </div>
  `).join('');

  elements.operationsList.innerHTML = html;
}

// ============================================================================
// Abilities
// ============================================================================

async function loadAbilities() {
  try {
    let data = await fetchAbilities();
    state.abilities.system = data.system || [];
    state.abilities.user   = data.user || [];
  } catch (error) {
    console.error('Failed to load abilities:', error);
  }
}

// Note: Modal functions (showAbilitiesModal, showAgentsModal, etc.) have been moved to hero-modal-* components

// ============================================================================
// Event Listeners
// ============================================================================

// Login
elements.loginForm.addEventListener('submit', handleLogin);

// Session search
let searchDebounce = null;
if (elements.sessionSearch) {
  elements.sessionSearch.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.searchQuery = e.target.value.trim();
      renderSessionsList();
    }, 200);
  });
}

// Toggle hidden sessions (archived, agent, etc.)
if (elements.toggleArchived) {
  elements.toggleArchived.addEventListener('click', async () => {
    state.showHidden = !state.showHidden;
    elements.toggleArchived.classList.toggle('active', state.showHidden);
    elements.toggleArchived.title = (state.showHidden) ? 'Hide archived/agent sessions' : 'Show all sessions';

    // Reload sessions with new filter
    state.sessions = await fetchSessions();
    renderSessionsList();
  });
}

// Chat (elements may be null if using hero-input component)
if (elements.sendBtn) {
  elements.sendBtn.addEventListener('click', handleSendMessage);
}
if (elements.messageInput) {
  elements.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });
  elements.messageInput.addEventListener('input', () => {
    autoResizeTextarea(elements.messageInput);
  });
}
// Chat header elements (may be null if using hero-header component)
if (elements.clearButton) {
  elements.clearButton.addEventListener('click', handleClearMessages);
}
if (elements.backBtn) {
  elements.backBtn.addEventListener('click', () => navigate('/'));
}
if (elements.chatLogoutBtn) {
  elements.chatLogoutBtn.addEventListener('click', handleLogout);
}
if (elements.sessionSelect) {
  elements.sessionSelect.addEventListener('change', () => {
    let sessionId = elements.sessionSelect.value;

    if (sessionId)
      navigate(`/sessions/${sessionId}`);
  });
}

// Scroll-to-bottom button
if (elements.scrollToBottomBtn && elements.chatMain) {
  elements.scrollToBottomBtn.addEventListener('click', () => {
    forceScrollToBottom();
  });

  elements.chatMain.addEventListener('scroll', () => {
    updateScrollToBottomButton();
  });
}

// Show hidden messages toggle
if (elements.showHiddenToggle) {
  elements.showHiddenToggle.addEventListener('change', () => {
    state.showHiddenMessages = elements.showHiddenToggle.checked;
    console.log('[DEBUG] showHiddenMessages toggled:', state.showHiddenMessages);
    console.log('[DEBUG] Total messages:', state.messages.length);
    console.log('[DEBUG] Hidden messages:', state.messages.filter((m) => m.hidden).length);
    renderMessages();
  });
}

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
// Component Events (hero-header, etc.)
// ============================================================================

// Handle navigate events from components
document.addEventListener('navigate', (e) => {
  let path = e.detail?.path;
  if (path) {
    window.history.pushState({}, '', BASE_PATH + path);
    handleRoute();
  }
});

// Handle logout events from components
document.addEventListener('logout', () => {
  handleLogout();
});

// Note: show-modal events are now handled by hero-modal-* components directly
// They listen for 'show-modal' and open themselves based on event.detail.modal

// Handle clear-messages events from components
document.addEventListener('clear-messages', () => {
  handleClearMessages();
});

// Handle toggle-hidden events from components
document.addEventListener('toggle-hidden', (e) => {
  state.showHiddenMessages = e.detail?.show ?? false;
  renderMessages();
});

// Handle send events from hero-input
document.addEventListener('hero:send-message', async (e) => {
  let { content, streaming, sessionId } = e.detail || {};
  if (content && sessionId) {
    // Call the existing sendMessage logic
    let inputEl = document.querySelector('hero-input');
    await handleSendMessageContent(content, streaming);
    if (inputEl) inputEl.loading = false;
  }
});

// Handle command events from hero-input
document.addEventListener('hero:command', (e) => {
  let command = e.detail?.command;
  if (command) {
    handleCommand(command);
  }
});

// Handle clear events from hero-input
document.addEventListener('hero:clear', () => {
  handleClearMessages();
});

// ============================================================================
// Initialize
// ============================================================================

handleRoute();
