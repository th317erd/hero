'use strict';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format a token count for human display.
 * @param {number} tokens - Token count
 * @returns {string} Formatted string (e.g., "1.2k", "15k")
 */
function formatTokenCount(tokens) {
  if (tokens < 1000) {
    return tokens.toString();
  } else if (tokens < 10000) {
    return (tokens / 1000).toFixed(1) + 'k';
  } else {
    return Math.round(tokens / 1000) + 'k';
  }
}

/**
 * Calculate API cost from token counts.
 * Claude Sonnet 4 pricing: $3/1M input, $15/1M output
 * @param {number} inputTokens - Input token count
 * @param {number} outputTokens - Output token count
 * @returns {number} Cost in dollars
 */
function calculateCost(inputTokens, outputTokens) {
  let inputCost  = (inputTokens / 1_000_000) * 3;    // $3 per 1M input
  let outputCost = (outputTokens / 1_000_000) * 15;  // $15 per 1M output
  return inputCost + outputCost;
}

/**
 * Format cost for display.
 * @param {number} cost - Cost in dollars
 * @returns {string} Formatted string (e.g., "$0.00", "$0.02", "$1.45")
 */
function formatCost(cost) {
  return '$' + cost.toFixed(2);
}

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
      let messageElement = document.getElementById(`msg-${message.id}`);
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
      `<button class="btn btn-secondary question-option" data-assertion-id="${id}" data-answer="${escapeHtml(String(opt))}">${escapeHtml(String(opt))}</button>`
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

// ============================================================================
// Ability Approval UI
// ============================================================================

function renderAbilityApproval(approval) {
  let { executionId, abilityName, description, params, dangerLevel, status } = approval;

  // If already resolved, show status
  if (status === 'approved') {
    return `
      <div class="approval-request safe" data-execution-id="${escapeHtml(executionId)}">
        <div class="approval-header">
          <span class="approval-icon">✓</span>
          <span class="approval-title">Approved</span>
        </div>
        <div class="approval-body">
          <div class="approval-ability-name">${escapeHtml(abilityName)}</div>
        </div>
      </div>
    `;
  }

  if (status === 'denied') {
    return `
      <div class="approval-request dangerous" data-execution-id="${escapeHtml(executionId)}">
        <div class="approval-header">
          <span class="approval-icon">✕</span>
          <span class="approval-title">Denied</span>
        </div>
        <div class="approval-body">
          <div class="approval-ability-name">${escapeHtml(abilityName)}</div>
        </div>
      </div>
    `;
  }

  // Pending approval request
  let dangerClass = (dangerLevel === 'dangerous') ? 'dangerous' : ((dangerLevel === 'safe') ? 'safe' : '');
  let paramsHtml  = (params) ? `<pre class="approval-params">${escapeHtml(JSON.stringify(params, null, 2))}</pre>` : '';

  return `
    <div class="approval-request ${dangerClass}" data-execution-id="${escapeHtml(executionId)}">
      <div class="approval-header">
        <span class="approval-icon">🔒</span>
        <span class="approval-title">Permission Required</span>
      </div>
      <div class="approval-body">
        <div class="approval-ability-name">${escapeHtml(abilityName)}</div>
        ${(description) ? `<div class="approval-description">${escapeHtml(description)}</div>` : ''}
        ${paramsHtml}
      </div>
      <div class="approval-actions">
        <button class="btn-approve" onclick="handleAbilityApprove('${escapeHtml(executionId)}')">
          <span>👍</span> Approve
        </button>
        <button class="btn-deny" onclick="handleAbilityDeny('${escapeHtml(executionId)}')">
          <span>👎</span> Deny
        </button>
      </div>
      <label class="approval-remember">
        <input type="checkbox" id="remember-${escapeHtml(executionId)}">
        <span>Remember for this session</span>
      </label>
    </div>
  `;
}

function renderAbilityQuestion(question) {
  let { questionId, prompt, type, options, status, answer, defaultValue, timeout } = question;

  // If already answered, show the answer
  if (status === 'answered' && answer !== undefined) {
    return `
      <div class="ability-question" data-question-id="${escapeHtml(questionId)}">
        <div class="question-header">
          <span class="question-icon">💬</span>
          <span>Question Answered</span>
        </div>
        <div class="question-prompt">${escapeHtml(prompt)}</div>
        <div class="question-answer">Answer: <strong>${escapeHtml(String(answer))}</strong></div>
      </div>
    `;
  }

  // Render based on question type
  let inputHtml = '';

  if (type === 'binary') {
    inputHtml = `
      <div class="question-binary">
        <button class="btn-yes" onclick="handleAbilityQuestionAnswer('${escapeHtml(questionId)}', true)">👍</button>
        <button class="btn-no" onclick="handleAbilityQuestionAnswer('${escapeHtml(questionId)}', false)">👎</button>
      </div>
    `;
  } else if (type === 'number' || type === 'float') {
    let step = (type === 'float') ? '0.01' : '1';
    inputHtml = `
      <input type="number" step="${step}" class="question-input" id="ability-q-${escapeHtml(questionId)}"
             placeholder="Enter a ${type}..." value="${defaultValue || ''}">
      <button class="btn btn-primary" onclick="submitAbilityQuestionInput('${escapeHtml(questionId)}', '${type}')">Submit</button>
    `;
  } else if (options && options.length > 0) {
    // Multiple choice
    inputHtml = `
      <div class="question-choices">
        ${options.map((opt) => `
          <button class="question-choice" onclick="handleAbilityQuestionAnswer('${escapeHtml(questionId)}', '${escapeHtml(String(opt))}')">${escapeHtml(String(opt))}</button>
        `).join('')}
      </div>
    `;
  } else {
    // Free-form string
    inputHtml = `
      <input type="text" class="question-input" id="ability-q-${escapeHtml(questionId)}"
             placeholder="Type your answer..." value="${defaultValue || ''}">
      <button class="btn btn-primary" onclick="submitAbilityQuestionInput('${escapeHtml(questionId)}', 'string')">Submit</button>
    `;
  }

  let timeoutHtml = (timeout) ? `<div class="question-timeout">Timeout: ${Math.round(timeout / 1000)}s</div>` : '';

  return `
    <div class="ability-question" data-question-id="${escapeHtml(questionId)}">
      <div class="question-header">
        <span class="question-icon">❓</span>
        <span>Question</span>
      </div>
      <div class="question-prompt">${escapeHtml(prompt)}</div>
      ${inputHtml}
      ${timeoutHtml}
    </div>
  `;
}

function handleAbilityApprove(executionId) {
  let rememberCheckbox = document.getElementById(`remember-${executionId}`);
  let rememberForSession = rememberCheckbox?.checked || false;

  sendAbilityApprovalResponse(executionId, true, null, rememberForSession);
}

function handleAbilityDeny(executionId) {
  let reason = prompt('Reason for denial (optional):');
  sendAbilityApprovalResponse(executionId, false, reason, false);
}

function sendAbilityApprovalResponse(executionId, approved, reason, rememberForSession) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN)
    return;

  state.ws.send(JSON.stringify({
    type: 'ability_approval_response',
    executionId,
    approved,
    reason,
    rememberForSession,
  }));

  // Update local state
  if (state.pendingApprovals[executionId]) {
    state.pendingApprovals[executionId].status = (approved) ? 'approved' : 'denied';
    updateAbilityApprovalUI(executionId);
  }
}

function handleAbilityQuestionAnswer(questionId, answer) {
  sendAbilityQuestionAnswer(questionId, answer);
}

function submitAbilityQuestionInput(questionId, type) {
  let input = document.getElementById(`ability-q-${questionId}`);
  if (!input)
    return;

  let value = input.value;

  if (type === 'number')
    value = parseInt(value, 10);
  else if (type === 'float')
    value = parseFloat(value);

  sendAbilityQuestionAnswer(questionId, value);
}

function sendAbilityQuestionAnswer(questionId, answer) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN)
    return;

  state.ws.send(JSON.stringify({
    type: 'ability_question_answer',
    questionId,
    answer,
  }));

  // Update local state
  if (state.pendingAbilityQs[questionId]) {
    state.pendingAbilityQs[questionId].status = 'answered';
    state.pendingAbilityQs[questionId].answer = answer;
    updateAbilityQuestionUI(questionId);
  }
}

function updateAbilityApprovalUI(executionId) {
  let approval = state.pendingApprovals[executionId];
  if (!approval)
    return;

  let el = document.querySelector(`[data-execution-id="${executionId}"]`);
  if (el)
    el.outerHTML = renderAbilityApproval(approval);
}

function updateAbilityQuestionUI(questionId) {
  let question = state.pendingAbilityQs[questionId];
  if (!question)
    return;

  let el = document.querySelector(`[data-question-id="${questionId}"]`);
  if (el)
    el.outerHTML = renderAbilityQuestion(question);
}

function renderLinkElement(assertion) {
  let { id, mode, url, messageId, text, label } = assertion;
  let icon = (mode === 'clipboard') ? '📋' : ((mode === 'internal') ? '↓' : '🔗');
  let clickAction = '';

  if (mode === 'external') {
    clickAction = `onclick="window.open('${escapeHtml(url)}', '_blank')"`;
  } else if (mode === 'internal') {
    clickAction = `onclick="scrollToMessage('${escapeHtml(messageId)}')"`;
  } else if (mode === 'clipboard') {
    clickAction = `onclick="copyToClipboard('${escapeHtml(text)}', this)"`;
  }

  return `
    <div class="element-link" data-element-id="${id}">
      <button class="link-button link-${mode}" ${clickAction}>
        <span class="link-icon">${icon}</span>
        <span class="link-label">${escapeHtml(label)}</span>
        ${(mode === 'clipboard') ? '<span class="link-copied" style="display:none">Copied!</span>' : ''}
      </button>
    </div>
  `;
}

function renderTodoElement(assertion) {
  let { id, title, items, collapsed } = assertion;
  items = items || [];

  let completedCount = items.filter((i) => i.status === 'completed').length;
  let totalCount     = items.length;
  let progressPct    = (totalCount > 0) ? Math.round((completedCount / totalCount) * 100) : 0;

  let itemsHtml = items.map((item) => {
    let statusIcon = (item.status === 'completed') ? '✓' : ((item.status === 'in_progress') ? '⏳' : '○');
    return `
      <li class="todo-item ${item.status}" data-item-id="${item.id}">
        <span class="todo-status">${statusIcon}</span>
        <span class="todo-text">${escapeHtml(item.text)}</span>
      </li>
    `;
  }).join('');

  return `
    <div class="element-todo ${(collapsed) ? 'collapsed' : ''}" data-element-id="${id}">
      <div class="todo-header" onclick="toggleTodoCollapse('${id}')">
        <span class="todo-title">${escapeHtml(title || 'Tasks')}</span>
        <span class="todo-progress">${completedCount}/${totalCount}</span>
        <span class="todo-toggle">${(collapsed) ? '▶' : '▼'}</span>
      </div>
      <div class="todo-progress-bar">
        <div class="todo-progress-fill" style="width: ${progressPct}%"></div>
      </div>
      <ul class="todo-items" ${(collapsed) ? 'style="display:none"' : ''}>
        ${itemsHtml}
      </ul>
    </div>
  `;
}

function renderProgressElement(assertion) {
  let { id, percentage, label, status } = assertion;
  percentage = Math.max(0, Math.min(100, Number(percentage) || 0));

  return `
    <div class="element-progress" data-element-id="${id}">
      <div class="progress-header">
        <span class="progress-label">${escapeHtml(label || 'Progress')}</span>
        <span class="progress-percentage">${percentage}%</span>
      </div>
      <div class="progress-bar-container">
        <div class="progress-bar" style="width: ${percentage}%"></div>
      </div>
      ${(status) ? `<div class="progress-status">${escapeHtml(status)}</div>` : ''}
    </div>
  `;
}

// Element interaction helpers
function scrollToMessage(messageId) {
  let msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
  if (msgEl) {
    msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    msgEl.classList.add('highlight');
    setTimeout(() => msgEl.classList.remove('highlight'), 2000);
  }
}

function copyToClipboard(text, buttonEl) {
  navigator.clipboard.writeText(text).then(() => {
    let copiedSpan = buttonEl.querySelector('.link-copied');
    let labelSpan  = buttonEl.querySelector('.link-label');
    if (copiedSpan && labelSpan) {
      labelSpan.style.display  = 'none';
      copiedSpan.style.display = 'inline';
      setTimeout(() => {
        labelSpan.style.display  = 'inline';
        copiedSpan.style.display = 'none';
      }, 1500);
    }
  }).catch((err) => {
    console.error('Failed to copy:', err);
  });
}

function toggleTodoCollapse(elementId) {
  let todoEl = document.querySelector(`[data-element-id="${elementId}"]`);
  if (!todoEl) return;

  let isCollapsed = todoEl.classList.toggle('collapsed');
  let itemsEl     = todoEl.querySelector('.todo-items');
  let toggleEl    = todoEl.querySelector('.todo-toggle');

  if (itemsEl)  itemsEl.style.display  = (isCollapsed) ? 'none' : 'block';
  if (toggleEl) toggleEl.textContent   = (isCollapsed) ? '▶' : '▼';
}

function renderAssertionsForMessage(messageId) {
  let assertions = state.assertions[messageId];
  if (!assertions || assertions.length === 0)
    return '';

  return assertions.map((a) => renderAssertionBlock(a)).join('');
}

/**
 * Scroll to bottom only if user is already near the bottom (auto-follow behavior).
 * This prevents jarring scrolls while reading older messages.
 */
function scrollToBottom() {
  if (isNearBottom()) {
    forceScrollToBottom();
  }
}

/**
 * Force scroll to bottom regardless of current position.
 * Use this for explicit user actions like clicking the scroll button.
 */
function forceScrollToBottom() {
  requestAnimationFrame(() => {
    let chatMain = elements.messagesContainer.parentElement;
    chatMain.scrollTop = chatMain.scrollHeight;
    updateScrollToBottomButton();
  });
}

/**
 * Check if the user is near the bottom of the chat.
 * @returns {boolean} True if within 100px of bottom
 */
function isNearBottom() {
  let chatMain = elements.chatMain;
  if (!chatMain) return true;
  let threshold = 100; // pixels from bottom
  return chatMain.scrollHeight - chatMain.scrollTop - chatMain.clientHeight < threshold;
}

/**
 * Update visibility of the scroll-to-bottom button.
 */
function updateScrollToBottomButton() {
  if (!elements.scrollToBottomBtn) return;

  if (isNearBottom()) {
    elements.scrollToBottomBtn.style.display = 'none';
  } else {
    elements.scrollToBottomBtn.style.display = 'flex';
  }
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

  if (!content || !state.currentSession)
    return;

  // Clear input immediately
  elements.messageInput.value        = '';
  elements.messageInput.style.height = 'auto';

  // Check for commands (always process immediately)
  if (content.startsWith('/')) {
    await handleCommand(content);
    elements.messageInput.focus();
    return;
  }

  // If busy, queue the message instead
  if (state.isLoading) {
    queueMessage(content);
    elements.messageInput.focus();
    return;
  }

  // Process the message (use streaming or batch based on mode)
  if (state.streamingMode)
    await processMessageStream(content);
  else
    await processMessage(content);
}

function queueMessage(content) {
  let queueId = `queued-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Add to queue
  state.messageQueue.push({ id: queueId, content });

  // Add queued message to UI immediately
  state.messages.push({ role: 'user', content, queued: true, queueId });
  renderMessages();
  forceScrollToBottom(); // User just sent a message, always scroll to show it
}

async function processMessage(content) {
  state.isLoading           = true;
  elements.sendBtn.disabled = true;

  // Add user message optimistically (if not already in messages from queue)
  let existingQueued = state.messages.find((m) => m.queued && m.content === content);
  if (existingQueued) {
    // Remove queued styling
    existingQueued.queued = false;
    delete existingQueued.queueId;
    renderMessages();
  } else {
    state.messages.push({ role: 'user', content: content });
    renderMessages();
  }
  forceScrollToBottom(); // User just sent a message, always scroll to show it

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

  state.isLoading           = false;
  elements.sendBtn.disabled = false;
  elements.messageInput.focus();

  // Process any queued messages
  await processMessageQueue();
}

async function processMessageQueue() {
  if (state.messageQueue.length === 0)
    return;

  // Get next message from queue
  let queued = state.messageQueue.shift();

  // Process it (use streaming or batch based on mode)
  if (state.streamingMode)
    await processMessageStream(queued.content);
  else
    await processMessage(queued.content);
}

// ============================================================================
// Streaming Message Processing
// ============================================================================

/**
 * Process a message with streaming response.
 * Shows progressive text and HML element updates in real-time.
 */
async function processMessageStream(content) {
  debug('App', 'processMessageStream called', { contentLength: content.length });

  state.isLoading           = true;
  elements.sendBtn.disabled = true;

  let now = new Date().toISOString();

  // Add user message optimistically
  let existingQueued = state.messages.find((m) => m.queued && m.content === content);
  if (existingQueued) {
    debug('App', 'Found existing queued message, updating');
    existingQueued.queued    = false;
    existingQueued.createdAt = now;
    delete existingQueued.queueId;
    renderMessages();
  } else {
    debug('App', 'Adding new user message');
    state.messages.push({ role: 'user', content: content, createdAt: now });
    renderMessages();
  }
  forceScrollToBottom(); // User just sent a message, always scroll to show it

  // Initialize streaming message state
  state.streamingMessage = {
    id:       null,
    content:  '',
    elements: {},  // Map of elementId -> element state
  };
  debug('App', 'Initialized streaming message state');

  // Create streaming message placeholder
  createStreamingMessagePlaceholder();
  debug('App', 'Created streaming placeholder');

  try {
    debug('App', 'Calling sendMessageStream', { sessionId: state.currentSession.id });
    await sendMessageStream(state.currentSession.id, content, {
      onStart: (data) => {
        debug('App', 'onStart callback', data);
        state.streamingMessage.id = data.messageId;
        updateStreamingHeader(data.agentName || 'Assistant');

        // Set data-message-id on streaming element so hml-prompt can find it
        let streamingEl = document.getElementById('streaming-message');
        if (streamingEl && data.messageId) {
          streamingEl.setAttribute('data-message-id', data.messageId);
        }

        // Note: data.estimatedTokens is the total context size (history + system prompt),
        // not the response size, so we don't display it to avoid confusion with the
        // final response token count shown after completion.
      },

      onText: (data) => {
        debug('App', 'onText callback', { textLength: data.text.length, totalContent: state.streamingMessage.content.length });
        state.streamingMessage.content += data.text;
        updateStreamingContent(state.streamingMessage.content);
        scrollToBottom();
      },

      onElementStart: (data) => {
        debug('App', 'onElementStart callback', data);
        // Skip hml-prompt and response - they're Web Components that render themselves
        if (data.type === 'hml-prompt' || data.type === 'response') {
          return;
        }
        state.streamingMessage.elements[data.id] = {
          id:         data.id,
          type:       data.type,
          attributes: data.attributes,
          content:    '',
          status:     'streaming',
          executable: data.executable,
        };
        renderStreamingElement(data.id);
        scrollToBottom();
      },

      onElementUpdate: (data) => {
        if (state.streamingMessage.elements[data.id]) {
          state.streamingMessage.elements[data.id].content = data.content;
          renderStreamingElement(data.id);
        }
      },

      onElementComplete: (data) => {
        if (state.streamingMessage.elements[data.id]) {
          state.streamingMessage.elements[data.id].content = data.content;
          state.streamingMessage.elements[data.id].status  = (data.executable) ? 'pending' : 'complete';
          renderStreamingElement(data.id);
        }
      },

      onElementExecuting: (data) => {
        if (state.streamingMessage.elements[data.id]) {
          state.streamingMessage.elements[data.id].status = 'executing';
          renderStreamingElement(data.id);
        }
      },

      onElementResult: (data) => {
        if (state.streamingMessage.elements[data.id]) {
          state.streamingMessage.elements[data.id].status = 'complete';
          state.streamingMessage.elements[data.id].result = data.result;
          renderStreamingElement(data.id);
        }
      },

      onElementError: (data) => {
        if (state.streamingMessage.elements[data.id]) {
          state.streamingMessage.elements[data.id].status = 'error';
          state.streamingMessage.elements[data.id].error  = data.error;
          renderStreamingElement(data.id);
        }
      },

      onToolUseStart: (data) => {
        // Show tool use in streaming UI
        appendStreamingToolUse(data);
      },

      onToolResult: (data) => {
        // Update tool result in streaming UI
        updateStreamingToolResult(data);
      },

      // Interaction events (for <interaction> tag handling)
      onInteractionDetected: (data) => {
        debug('App', 'Interaction detected', { count: data.count, iteration: data.iteration });
        // Strip interaction tags from displayed content
        if (state.streamingMessage) {
          let cleanContent = stripInteractionTags(state.streamingMessage.content);
          state.streamingMessage.content = cleanContent;
          updateStreamingContent(cleanContent);
        }
        // Show indicator that interaction is being processed
        showStreamingStatus('Processing interaction...');
      },

      onInteractionStarted: (data) => {
        console.log('[TRACE] onInteractionStarted called:', data);
        console.log('[TRACE] state.streamingMessage:', !!state.streamingMessage);
        console.log('[TRACE] hasBanner:', !!data.banner);
        debug('App', 'Interaction started', data);

        // Only show banners for functions that opt-in via banner config
        // Functions without a banner config in their register() method are silent
        if (!data.banner) {
          console.log('[TRACE] No banner config, skipping banner for:', data.targetProperty);
          return;
        }

        // Use banner config for label and icon
        let label = data.banner.label || data.targetProperty || 'interaction';
        let icon = data.banner.icon || '⚡';
        let content = '';

        // Get content from payload using banner.contentKey
        if (data.banner.contentKey && data.payload?.[data.banner.contentKey]) {
          content = data.payload[data.banner.contentKey];
        } else if (data.payload) {
          content = (typeof data.payload === 'string') ? data.payload : JSON.stringify(data.payload);
        }

        // Track pending interaction
        if (!state.streamingMessage.pendingInteractions) {
          state.streamingMessage.pendingInteractions = {};
        }
        state.streamingMessage.pendingInteractions[data.interactionId] = {
          label,
          icon,
          content,
          status:    'pending',
          startTime: Date.now(),
        };

        // Update the streaming content to show pending banner
        appendInteractionBanner(data.interactionId, label, content, 'pending', icon);
      },

      onInteractionUpdate: (data) => {
        console.log('[TRACE] onInteractionUpdate:', data);
        debug('App', 'Interaction update', data);
        // Update the pending banner with new content (e.g., actual query after "...")
        if (state.streamingMessage?.pendingInteractions?.[data.interactionId]) {
          let pending = state.streamingMessage.pendingInteractions[data.interactionId];
          if (data.payload?.query) {
            pending.content = data.payload.query;
            // Update the banner content in DOM
            updateInteractionBannerContent(data.interactionId, data.payload.query);
          }
        }
      },

      onInteractionResult: (data) => {
        console.log('[TRACE] onInteractionResult:', {
          interactionId:       data.interactionId,
          status:              data.status,
          hasStreamingMessage: !!state.streamingMessage,
          hasPendingInteractions: !!state.streamingMessage?.pendingInteractions,
          pendingKeys:         state.streamingMessage?.pendingInteractions ? Object.keys(state.streamingMessage.pendingInteractions) : [],
        });
        debug('App', 'Interaction result', data);
        // Update the pending banner to show complete status
        let elapsedMs = null;
        if (state.streamingMessage?.pendingInteractions?.[data.interactionId]) {
          let pending = state.streamingMessage.pendingInteractions[data.interactionId];
          pending.status = data.status;
          elapsedMs = Date.now() - pending.startTime;
        } else {
          console.log('[TRACE] onInteractionResult: pending interaction not in state (may be finalized), updating banner directly');
        }
        // Always try to update the banner - it may still be in the DOM even after finalization
        updateInteractionBanner(data.interactionId, data.status, data.result, elapsedMs);
      },

      onInteractionContinuing: (data) => {
        debug('App', 'Interaction continuing, getting final response');
        showStreamingStatus('Getting response...');
      },

      onInteractionComplete: (data) => {
        console.log('[TRACE] onInteractionComplete called:', {
          hasContent:            !!data.content,
          contentLength:         data.content?.length,
          hasStreamingMessage:   !!state.streamingMessage,
          contentPreview:        data.content?.slice(0, 100),
        });
        debug('App', 'Interaction complete', { contentLength: data.content?.length });
        // Update the streaming content with the final clean content
        if (data.content && state.streamingMessage) {
          state.streamingMessage.content = data.content;
          updateStreamingContent(data.content);
          console.log('[TRACE] Updated streaming content');
        } else {
          console.log('[TRACE] Did NOT update streaming content');
        }
        hideStreamingStatus();
      },

      onInteractionError: (data) => {
        debug('App', 'Interaction error', data);
        hideStreamingStatus();
      },

      onRateLimitWait: (data) => {
        debug('App', 'Rate limit wait', data);
        showStreamingStatus(`Rate limit reached. Waiting ${data.waitSeconds}s before retrying (attempt ${data.retryCount}/3)...`);
      },

      onUsage: (data) => {
        debug('App', 'Token usage', data);
        // Calculate cost from tokens
        let inputTokens  = data.input_tokens || 0;
        let outputTokens = data.output_tokens || 0;
        let cost = calculateCost(inputTokens, outputTokens);

        // Update local spend tracking (real-time display)
        state.sessionSpend.cost += cost;
        state.serviceSpend.cost += cost;
        state.globalSpend.cost  += cost;

        // Update cost display
        updateCostDisplay();
      },

      onComplete: (data) => {
        console.log('[TRACE] onComplete called:', {
          hasContent:      !!data.content,
          contentLength:   data.content?.length,
          warning:         data.warning,
          contentPreview:  data.content?.slice(0, 100),
        });
        debug('App', 'onComplete callback', data);
        // Check for warning (empty response)
        if (data.warning && !data.content) {
          debug('App', 'Warning received:', data.warning);
          showStreamingError('Agent returned no response. This may indicate an API issue.');
          return;
        }
        // Finalize the streaming message
        finalizeStreamingMessage(data);
        console.log('[TRACE] Finalization complete');
      },

      onError: (data) => {
        debug('App', 'onError callback', data);
        showStreamingError(data.error);
      },
    });

    debug('App', 'sendMessageStream resolved, checking if finalization needed');

    // Ensure streaming message is finalized even if onComplete wasn't called
    if (state.streamingMessage) {
      debug('App', 'Finalizing streaming message (fallback)', {
        contentLength: state.streamingMessage.content.length,
        messageId: state.streamingMessage.id,
      });
      finalizeStreamingMessage({
        content: state.streamingMessage.content,
        messageId: state.streamingMessage.id,
      });
    }
  } catch (error) {
    debug('App', 'processMessageStream caught error', error.message);
    console.error('Stream error:', error);
    showStreamingError(error.message);
  }

  debug('App', 'processMessageStream complete');
  state.isLoading           = false;
  elements.sendBtn.disabled = false;
  elements.messageInput.focus();

  // Process any queued messages
  await processMessageQueue();
}

/**
 * Create the streaming message placeholder in the chat.
 */
function createStreamingMessagePlaceholder() {
  let agentName = state.currentSession?.agent?.name || 'Assistant';

  let html = `
    <div class="message message-assistant message-streaming" id="streaming-message">
      <div class="message-header">${escapeHtml(agentName)}</div>
      <div class="message-bubble">
        <div class="streaming-content message-content"></div>
        <div class="streaming-elements"></div>
        <div class="streaming-indicator">
          <hero-interaction status="processing" message="Thinking..."></hero-interaction>
        </div>
      </div>
    </div>
  `;

  elements.messagesContainer.insertAdjacentHTML('beforeend', html);
}

/**
 * Update the streaming message header (e.g., with agent name).
 */
function updateStreamingHeader(agentName) {
  let el = document.querySelector('#streaming-message .message-header');
  if (el)
    el.textContent = agentName;
}

/**
 * Update the streaming content with new text.
 */
function updateStreamingContent(content) {
  let el = document.querySelector('#streaming-message .streaming-content');
  console.log('[TRACE] updateStreamingContent:', {
    elementFound:   !!el,
    contentLength:  content?.length,
    contentPreview: content?.slice(0, 100),
  });
  if (el)
    el.innerHTML = renderMarkup(content);
}

/**
 * Render a streaming HML element.
 */
function renderStreamingElement(elementId) {
  let element   = state.streamingMessage.elements[elementId];
  let container = document.querySelector('#streaming-message .streaming-elements');

  if (!element || !container) return;

  let existingEl = container.querySelector(`[data-element-id="${elementId}"]`);
  let html       = renderStreamingElementHtml(element);

  if (existingEl) {
    existingEl.outerHTML = html;
  } else {
    container.insertAdjacentHTML('beforeend', html);
  }
}

/**
 * Generate HTML for a streaming HML element.
 */
function renderStreamingElementHtml(element) {
  let statusClass = `streaming-element-${element.status}`;
  let statusIcon  = getStreamingStatusIcon(element.status);
  let typeIcon    = getElementTypeIcon(element.type);

  let contentHtml = '';
  if (element.content) {
    contentHtml = `<div class="streaming-element-content">${escapeHtml(element.content)}</div>`;
  }

  let resultHtml = '';
  if (element.result) {
    let resultText = (typeof element.result === 'string') ? element.result : JSON.stringify(element.result, null, 2);
    resultHtml = `<div class="streaming-element-result"><pre>${escapeHtml(resultText)}</pre></div>`;
  }

  let errorHtml = '';
  if (element.error) {
    errorHtml = `<div class="streaming-element-error">${escapeHtml(element.error)}</div>`;
  }

  return `
    <div class="streaming-element ${statusClass}" data-element-id="${element.id}">
      <div class="streaming-element-header">
        <span class="streaming-element-icon">${typeIcon}</span>
        <span class="streaming-element-type">${escapeHtml(element.type)}</span>
        <span class="streaming-element-status">${statusIcon}</span>
      </div>
      ${contentHtml}
      ${resultHtml}
      ${errorHtml}
    </div>
  `;
}

/**
 * Get status icon for streaming element.
 */
function getStreamingStatusIcon(status) {
  switch (status) {
    case 'streaming':  return '<span class="status-streaming">...</span>';
    case 'pending':    return '<span class="status-pending">⏳</span>';
    case 'executing':  return '<span class="status-executing"><span class="spinner"></span></span>';
    case 'complete':   return '<span class="status-complete">✓</span>';
    case 'error':      return '<span class="status-error">✗</span>';
    default:           return '';
  }
}

/**
 * Get icon for element type.
 */
function getElementTypeIcon(type) {
  switch (type) {
    case 'websearch': return '🔍';
    case 'bash':      return '$';
    case 'ask':       return '❓';
    case 'thinking':  return '💭';
    case 'todo':      return '📋';
    case 'progress':  return '📊';
    case 'link':      return '🔗';
    case 'copy':      return '📋';
    case 'result':    return '📄';
    default:          return '▪';
  }
}

/**
 * Append tool use to streaming message.
 */
function appendStreamingToolUse(data) {
  let container = document.querySelector('#streaming-message .streaming-elements');
  if (!container) return;

  let html = `
    <div class="streaming-tool-use" data-tool-id="${escapeHtml(data.toolId || '')}">
      <div class="streaming-tool-header">
        <span class="streaming-tool-icon">⚙</span>
        <span class="streaming-tool-name">${escapeHtml(data.name || 'Tool')}</span>
        <span class="streaming-tool-status"><span class="spinner"></span></span>
      </div>
    </div>
  `;

  container.insertAdjacentHTML('beforeend', html);
}

/**
 * Update tool result in streaming message.
 */
function updateStreamingToolResult(data) {
  let el = document.querySelector(`#streaming-message .streaming-tool-use[data-tool-id="${data.toolId}"]`);
  if (!el) return;

  let statusEl = el.querySelector('.streaming-tool-status');
  if (statusEl)
    statusEl.innerHTML = '<span class="status-complete">✓</span>';

  let resultHtml = `<div class="streaming-tool-result"><pre>${escapeHtml(data.content || '')}</pre></div>`;
  el.insertAdjacentHTML('beforeend', resultHtml);
}

/**
 * Finalize the streaming message and add to state.
 * Idempotent - safe to call multiple times.
 */
function finalizeStreamingMessage(data) {
  console.log('[TRACE] finalizeStreamingMessage called:', {
    hasData:               !!data,
    hasDataContent:        !!data?.content,
    dataContentLength:     data?.content?.length,
    hasStreamingMessage:   !!state.streamingMessage,
    streamingContentLen:   state.streamingMessage?.content?.length,
  });
  debug('App', 'finalizeStreamingMessage called', data);

  // Skip if already finalized
  if (!state.streamingMessage) {
    console.log('[TRACE] Already finalized, skipping');
    debug('App', 'Already finalized, skipping');
    return;
  }

  // Remove streaming indicator
  let indicator = document.querySelector('#streaming-message .streaming-indicator');
  if (indicator) {
    debug('App', 'Removing streaming indicator');
    indicator.remove();
  }

  // Remove any status messages
  let statusEl = document.querySelector('#streaming-message .streaming-status');
  if (statusEl)
    statusEl.remove();

  // Keep interaction banners visible (they show what actions were taken)
  // Just update their status to reflect completion
  let banners = document.querySelectorAll('#streaming-message .interaction-banner');
  console.log('[TRACE] Found interaction banners to preserve:', banners.length);

  // Determine final content
  let finalContent = data.content || state.streamingMessage.content;
  debug('App', 'Final content', { length: finalContent.length, preview: finalContent.slice(0, 100) });

  // Update the displayed content (may differ from streamed content due to interaction handling)
  let streamingEl = document.getElementById('streaming-message');
  console.log('[TRACE] finalizeStreamingMessage update:', {
    streamingElFound:  !!streamingEl,
    finalContentLen:   finalContent?.length,
    finalContentPrev:  finalContent?.slice(0, 100),
  });
  if (streamingEl) {
    let contentEl = streamingEl.querySelector('.streaming-content');
    if (contentEl) {
      console.log('[TRACE] Setting innerHTML on streaming-content element');
      contentEl.innerHTML = renderMarkup(finalContent);
    }

    // Add timestamp and token count
    let now = new Date().toISOString();
    let tokenEstimate = Math.ceil(finalContent.length / 4);
    let timeStr  = formatRelativeDate(now);
    let tokenStr = formatTokenCount(tokenEstimate);
    let timestampEl = document.createElement('div');
    timestampEl.className = 'message-timestamp';
    timestampEl.textContent = `${timeStr} · ~${tokenStr} tokens`;
    streamingEl.appendChild(timestampEl);

    debug('App', 'Removing streaming class from element');
    streamingEl.classList.remove('message-streaming');

    // Update data-message-id with the persisted database ID if available
    if (data.persistedMessageID) {
      streamingEl.setAttribute('data-message-id', data.persistedMessageID);
      debug('App', 'Updated data-message-id to persisted ID:', data.persistedMessageID);
    }

    streamingEl.removeAttribute('id');
  }

  // Check if the message was already added via WebSocket broadcast
  let alreadyExists = state.messages.some(
    (m) => m.role === 'assistant' && m.content === finalContent
  );

  if (!alreadyExists) {
    let now = new Date().toISOString();
    state.messages.push({
      id:        data.persistedMessageID || state.streamingMessage.id,
      role:      'assistant',
      content:   finalContent,
      createdAt: now,
    });
    debug('App', 'Added message to state, total messages:', state.messages.length);
  } else {
    debug('App', 'Message already exists (from WebSocket), skipping add');
  }

  // Clear streaming state
  state.streamingMessage = null;
  debug('App', 'Streaming state cleared');
}

/**
 * Show error in streaming message.
 */
function showStreamingError(errorMessage) {
  let streamingEl = document.getElementById('streaming-message');
  if (!streamingEl) return;

  // Remove streaming indicator
  let indicator = streamingEl.querySelector('.streaming-indicator');
  if (indicator)
    indicator.remove();

  // Add error message
  let bubble = streamingEl.querySelector('.message-bubble');
  if (bubble) {
    bubble.insertAdjacentHTML('beforeend', `
      <div class="streaming-error">
        <span class="error-icon">⚠</span>
        <span class="error-text">${escapeHtml(errorMessage)}</span>
      </div>
    `);
  }

  // Remove streaming class and id
  streamingEl.classList.remove('message-streaming');
  streamingEl.classList.add('message-error');
  streamingEl.removeAttribute('id');

  // Add error to state
  state.messages.push({
    role:      'assistant',
    content:   [{ type: 'text', text: `Error: ${errorMessage}` }],
    createdAt: new Date().toISOString(),
  });

  // Clear streaming state
  state.streamingMessage = null;
}

/**
 * Show a status message in the streaming message (for interactions).
 * Uses the <hero-interaction> WebComponent with jiggling brain emoji.
 */
function showStreamingStatus(message) {
  let streamingEl = document.getElementById('streaming-message');
  if (!streamingEl) return;

  // Find or create status element
  let statusEl = streamingEl.querySelector('.streaming-status');
  if (!statusEl) {
    let bubble = streamingEl.querySelector('.message-bubble');
    if (bubble) {
      bubble.insertAdjacentHTML('beforeend', `
        <div class="streaming-status">
          <hero-interaction status="processing" message="${escapeHtml(message)}"></hero-interaction>
        </div>
      `);
    }
  } else {
    let interactionEl = statusEl.querySelector('hero-interaction');
    if (interactionEl) {
      interactionEl.setAttribute('message', message);
    }
  }
}

/**
 * Hide the streaming status message.
 */
function hideStreamingStatus() {
  let statusEl = document.querySelector('#streaming-message .streaming-status');
  if (statusEl)
    statusEl.remove();
}

/**
 * Append an interaction banner to the streaming message.
 * Shows "Web Search: [query] - Pending" style banners.
 * Only called for functions that opt-in via banner config.
 *
 * @param {string} interactionId - Unique ID for this interaction
 * @param {string} label - Display label from banner config
 * @param {string} content - Content to display (from payload via contentKey)
 * @param {string} status - Status: 'pending', 'completed', 'failed'
 * @param {string} icon - Icon emoji from banner config (default: '⚡')
 */
function appendInteractionBanner(interactionId, label, content, status, icon = '⚡') {
  console.log('[TRACE] appendInteractionBanner called:', { interactionId, label, content, status, icon });
  let streamingEl = document.getElementById('streaming-message');
  console.log('[TRACE] streamingEl found:', !!streamingEl);
  if (!streamingEl) {
    console.log('[TRACE] No streaming element found, cannot append banner');
    return;
  }

  let bubble = streamingEl.querySelector('.message-bubble');
  console.log('[TRACE] bubble found:', !!bubble);
  if (!bubble) return;

  // Create the banner element
  let statusText = (status === 'pending') ? 'Pending' : status;

  let bannerHtml = `
    <div class="interaction-banner interaction-banner-${status}" data-interaction-id="${escapeHtml(interactionId)}">
      <span class="interaction-banner-icon">${icon}</span>
      <span class="interaction-banner-label">${escapeHtml(label)}:</span>
      <span class="interaction-banner-content">${escapeHtml(content.substring(0, 100))}${(content.length > 100) ? '...' : ''}</span>
      <span class="interaction-banner-status">${statusText}</span>
    </div>
  `;

  // Insert before streaming-content if it exists, otherwise append
  let contentEl = bubble.querySelector('.streaming-content');
  if (contentEl) {
    contentEl.insertAdjacentHTML('beforebegin', bannerHtml);
  } else {
    bubble.insertAdjacentHTML('afterbegin', bannerHtml);
  }
}

/**
 * Format milliseconds as human-readable time.
 */
function formatElapsedTime(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    let minutes = Math.floor(ms / 60000);
    let seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Update an interaction banner status.
 */
function updateInteractionBanner(interactionId, status, result, elapsedMs) {
  console.log('[TRACE] updateInteractionBanner:', { interactionId, status, elapsedMs });

  // Debug: list all banners in DOM
  let allBanners = document.querySelectorAll('.interaction-banner');
  console.log('[TRACE] All banners in DOM:', allBanners.length);
  allBanners.forEach((b, i) => {
    console.log(`[TRACE]   Banner ${i}: data-interaction-id="${b.getAttribute('data-interaction-id')}"`);
  });

  let banner = document.querySelector(`.interaction-banner[data-interaction-id="${interactionId}"]`);
  console.log('[TRACE] Banner found for interactionId:', !!banner, 'looking for:', interactionId);
  if (!banner) {
    console.log('[TRACE] BANNER NOT FOUND - cannot update');
    return;
  }

  // Update status
  let statusEl = banner.querySelector('.interaction-banner-status');
  if (statusEl) {
    let statusText;
    if (status === 'completed' && elapsedMs) {
      statusText = `Completed in ${formatElapsedTime(elapsedMs)}`;
    } else if (status === 'completed') {
      statusText = 'Complete';
    } else if (status === 'failed') {
      statusText = 'Failed';
    } else {
      statusText = status;
    }
    statusEl.textContent = statusText;
    console.log('[TRACE] Updated status text to:', statusText);
  } else {
    console.log('[TRACE] No statusEl found in banner!');
  }

  // Update class for styling
  banner.className = `interaction-banner interaction-banner-${status}`;
  console.log('[TRACE] Updated banner class to:', banner.className);
}

/**
 * Update an interaction banner content (e.g., when query becomes available).
 */
function updateInteractionBannerContent(interactionId, content) {
  console.log('[TRACE] updateInteractionBannerContent:', { interactionId, content });
  let banner = document.querySelector(`.interaction-banner[data-interaction-id="${interactionId}"]`);
  if (!banner) return;

  let contentEl = banner.querySelector('.interaction-banner-content');
  if (contentEl) {
    contentEl.textContent = content.substring(0, 100) + ((content.length > 100) ? '...' : '');
  }
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
      await handleHelpCommand(args);
      break;

    case 'session':
      state.messages.push({
        role:    'assistant',
        content: [{ type: 'text', text: `Current session: ${state.currentSession?.name || 'None'}\nSession ID: ${state.currentSession?.id || 'N/A'}` }],
      });
      renderMessages();
      forceScrollToBottom();
      break;

    case 'archive':
      await handleArchiveCommand();
      break;

    case 'ability':
      await handleAbilityCommand(args);
      break;

    case 'stream':
      handleStreamCommand(args);
      break;

    case 'update_usage':
    case 'update-usage':
      await handleUpdateUsageCommand(args);
      break;

    case 'start':
      await handleStartCommand();
      break;

    case 'compact':
      await handleCompactCommand();
      break;

    default:
      state.messages.push({
        role:    'assistant',
        content: [{ type: 'text', text: `Unknown command: /${command}\nType /help for available commands.` }],
      });
      renderMessages();
      forceScrollToBottom();
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

async function handleHelpCommand(filterArg = '') {
  try {
    // Build URL with filter if provided
    let url = `${BASE_PATH}/api/help`;
    if (filterArg.trim()) {
      url += `?filter=${encodeURIComponent(filterArg.trim())}`;
    }

    let response = await fetch(url);
    let help     = await response.json();

    // Check for error response (e.g., invalid regex)
    if (help.error) {
      state.messages.push({
        role:    'assistant',
        content: [{ type: 'text', text: `Error: ${help.error}` }],
      });
      renderMessages();
      scrollToBottom();
      return;
    }

    let text = '# Hero Help\n\n';

    // Show filter if applied
    if (filterArg.trim()) {
      text += `*Filtering by: \`${filterArg.trim()}\`*\n\n`;
    }

    let hasResults = false;

    // Built-in commands
    if (help.commands && (help.commands.builtin.length > 0 || help.commands.user.length > 0)) {
      hasResults = true;
      text += '## Commands\n';
      for (let cmd of help.commands.builtin) {
        text += `  /${cmd.name} - ${cmd.description}\n`;
      }

      if (help.commands.user.length > 0) {
        text += '\n### User Commands\n';
        for (let cmd of help.commands.user) {
          text += `  /${cmd.name} - ${cmd.description || 'No description'}\n`;
        }
      }
    }

    // System functions
    if (help.systemMethods && help.systemMethods.length > 0) {
      hasResults = true;
      text += '\n## System Functions\n';
      for (let fn of help.systemMethods) {
        text += `  ${fn.name} - ${fn.description || 'No description'}\n`;
      }
    }

    // Assertion types
    if (help.assertions && help.assertions.length > 0) {
      hasResults = true;
      text += '\n## Assertion Types\n';
      for (let assertion of help.assertions) {
        text += `  ${assertion.type} - ${assertion.description}\n`;
      }
    }

    // Abilities
    if (help.processes) {
      let hasSystemAbilities = help.processes.system && help.processes.system.length > 0;
      let hasUserAbilities   = help.processes.user && help.processes.user.length > 0;

      if (hasSystemAbilities || hasUserAbilities) {
        hasResults = true;
        text += '\n## Abilities\n';

        if (hasSystemAbilities) {
          text += '### System\n';
          for (let ability of help.processes.system) {
            text += `  ${ability.name} - ${ability.description || 'No description'}\n`;
          }
        }

        if (hasUserAbilities) {
          text += '\n### User Abilities\n';
          for (let ability of help.processes.user) {
            text += `  ${ability.name} - ${ability.description || 'No description'}\n`;
          }
        }
      }
    }

    // Show message if no results found with filter
    if (!hasResults && filterArg.trim()) {
      text += `No results found matching \`${filterArg.trim()}\`.\n`;
      text += '\nTry a different filter pattern or run `/help` without arguments to see all available help.';
    }

    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text }],
    });
    renderMessages();
    forceScrollToBottom();
  } catch (error) {
    console.error('Failed to fetch help:', error);
    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: 'Failed to load help information.' }],
    });
    renderMessages();
    forceScrollToBottom();
  }
}

function handleStreamCommand(args) {
  args = args.toLowerCase().trim();

  if (args === 'on' || args === 'enable') {
    state.streamingMode = true;
    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: 'Streaming mode enabled. Responses will appear progressively.' }],
    });
  } else if (args === 'off' || args === 'disable') {
    state.streamingMode = false;
    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: 'Streaming mode disabled. Responses will appear after completion.' }],
    });
  } else {
    let modeText = (state.streamingMode) ? 'enabled' : 'disabled';
    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: `Streaming mode is currently ${modeText}.\n\nUsage:\n/stream on  - Enable streaming\n/stream off - Disable streaming` }],
    });
  }

  renderMessages();
  forceScrollToBottom();
}

async function handleArchiveCommand() {
  if (!state.currentSession) {
    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: 'No active session to archive.' }],
    });
    renderMessages();
    forceScrollToBottom();
    return;
  }

  try {
    await fetch(`${BASE_PATH}/api/sessions/${state.currentSession.id}/archive`, {
      method: 'POST',
    });

    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: `Session "${state.currentSession.name}" has been archived.` }],
    });
    renderMessages();
    forceScrollToBottom();

    // Reload sessions
    state.sessions = await fetchSessions();
    renderSessionsList();
  } catch (error) {
    console.error('Failed to archive session:', error);
    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: 'Failed to archive session.' }],
    });
    renderMessages();
    forceScrollToBottom();
  }
}

/**
 * Handle /start command.
 * Re-sends startup instructions to the AI agent.
 */
async function handleStartCommand() {
  if (!state.currentSession) {
    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: 'No active session. Please select or create a session first.' }],
    });
    renderMessages();
    forceScrollToBottom();
    return;
  }

  try {
    // Fetch startup content from API
    let response = await fetch(`${BASE_PATH}/api/commands/start`);
    let result   = await response.json();

    if (!result.success) {
      state.messages.push({
        role:    'assistant',
        content: [{ type: 'text', text: `Failed to load startup instructions: ${result.error}` }],
      });
      renderMessages();
      forceScrollToBottom();
      return;
    }

    // Send the startup content to the AI as a system refresh message
    let systemContent = `[System Initialization - Refresh]\n\n${result.content}`;
    await processMessageStream(systemContent);
  } catch (error) {
    console.error('Failed to execute start command:', error);
    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: `Error: ${error.message}` }],
    });
    renderMessages();
    forceScrollToBottom();
  }
}

/**
 * Handle /compact command.
 * Forces conversation compaction into a summary snapshot.
 */
async function handleCompactCommand() {
  if (!state.currentSession) {
    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: 'No active session to compact.' }],
    });
    renderMessages();
    forceScrollToBottom();
    return;
  }

  state.messages.push({
    role:    'assistant',
    content: [{ type: 'text', text: 'Compacting conversation history...' }],
  });
  renderMessages();
  forceScrollToBottom();

  try {
    let response = await fetch(`${BASE_PATH}/api/commands/compact`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessionId: state.currentSession.id }),
    });

    let result = await response.json();

    if (result.success) {
      state.messages.push({
        role:    'assistant',
        content: [{ type: 'text', text: `**Compaction complete**\n\n${result.message}\n\n- Snapshot ID: ${result.details?.snapshotId || 'N/A'}\n- Messages compacted: ${result.details?.messagesCount || 0}\n- Summary length: ${result.details?.summaryLength || 0} chars` }],
      });
    } else {
      state.messages.push({
        role:    'assistant',
        content: [{ type: 'text', text: `Compaction failed: ${result.error}` }],
      });
    }

    renderMessages();
    forceScrollToBottom();
  } catch (error) {
    console.error('Failed to compact conversation:', error);
    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: `Error during compaction: ${error.message}` }],
    });
    renderMessages();
    forceScrollToBottom();
  }
}

/**
 * Handle /update_usage command.
 * Usage: /update_usage <cost>  - e.g., /update_usage 5.50
 * This updates the usage tracker to match the user's actual API cost.
 */
async function handleUpdateUsageCommand(args) {
  let input = args.trim();

  if (!input) {
    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: `Usage: /update_usage <cost>\n\nProvide your current actual API cost (in dollars).\n\nExample: /update_usage 5.50\n\nThis will adjust the usage tracker to match your actual spend.` }],
    });
    renderMessages();
    forceScrollToBottom();
    return;
  }

  // Parse cost - remove $ if present
  let actualCost = parseFloat(input.replace(/^\$/, ''));

  if (isNaN(actualCost) || actualCost < 0) {
    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: `Invalid cost: "${input}"\n\nPlease provide a number, e.g., /update_usage 5.50` }],
    });
    renderMessages();
    forceScrollToBottom();
    return;
  }

  try {
    let result = await createUsageCorrection({
      actualCost: actualCost,
      reason:     'User-reported actual cost',
    });

    let msg = `Usage correction applied.\n\n`;
    msg += `**Previous:** ${formatCost(result.previousCost)}\n`;
    msg += `**New:** ${formatCost(result.newCost)}\n`;

    if (result.correctionAmount !== 0) {
      let sign = (result.correctionAmount >= 0) ? '+' : '';
      msg += `**Adjustment:** ${sign}${formatCost(result.correctionAmount)}`;
    } else {
      msg += `No adjustment needed - tracking is accurate.`;
    }

    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: msg }],
    });
    renderMessages();
    forceScrollToBottom();

    // Reload usage to update the header display
    if (state.currentSession) {
      await loadSessionUsage(state.currentSession.id);
    } else {
      await loadGlobalUsage();
    }
  } catch (error) {
    console.error('Failed to update usage:', error);
    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: `Failed to update usage: ${error.message}` }],
    });
    renderMessages();
    forceScrollToBottom();
  }
}

async function handleAbilityCommand(args) {
  let parts      = args.trim().split(/\s+/);
  let subcommand = parts[0]?.toLowerCase() || 'list';
  let name       = parts.slice(1).join(' ');

  switch (subcommand) {
    case 'create':
    case 'new':
      showAbilityModal();
      break;

    case 'edit':
      if (!name) {
        state.messages.push({
          role:    'assistant',
          content: [{ type: 'text', text: 'Usage: /ability edit <name>' }],
        });
        renderMessages();
        forceScrollToBottom();
        return;
      }
      await editAbilityByName(name);
      break;

    case 'delete':
      if (!name) {
        state.messages.push({
          role:    'assistant',
          content: [{ type: 'text', text: 'Usage: /ability delete <name>' }],
        });
        renderMessages();
        forceScrollToBottom();
        return;
      }
      await deleteAbilityByName(name);
      break;

    case 'list':
    default:
      await listAbilities();
      break;
  }
}

async function listAbilities() {
  try {
    let response = await fetch(`${BASE_PATH}/api/abilities`);
    let data     = await response.json();

    let text = '# Abilities\n\n';

    // Group by type
    let processes = data.abilities.filter((a) => a.type === 'process');
    let functions = data.abilities.filter((a) => a.type === 'function');

    if (functions.length > 0) {
      text += '## Functions\n';
      for (let ability of functions) {
        let danger = (ability.dangerLevel !== 'safe') ? ` [${ability.dangerLevel}]` : '';
        text += `  **${ability.name}**${danger} - ${ability.description || 'No description'} (${ability.source})\n`;
      }
      text += '\n';
    }

    if (processes.length > 0) {
      text += '## Process Abilities\n';
      for (let ability of processes) {
        let danger = (ability.dangerLevel !== 'safe') ? ` [${ability.dangerLevel}]` : '';
        text += `  **${ability.name}**${danger} - ${ability.description || 'No description'} (${ability.source})\n`;
      }
    }

    if (data.abilities.length === 0)
      text += 'No abilities configured.\n';

    text += '\nCommands: /ability create, /ability edit <name>, /ability delete <name>';

    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text }],
    });
    renderMessages();
    forceScrollToBottom();
  } catch (error) {
    console.error('Failed to list abilities:', error);
    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: 'Failed to load abilities.' }],
    });
    renderMessages();
    forceScrollToBottom();
  }
}

async function editAbilityByName(name) {
  try {
    let response = await fetch(`${BASE_PATH}/api/abilities`);
    let data     = await response.json();

    let ability = data.abilities.find((a) => a.name === name && a.source === 'user');

    if (!ability) {
      state.messages.push({
        role:    'assistant',
        content: [{ type: 'text', text: `Ability "${name}" not found or cannot be edited (only user abilities can be edited).` }],
      });
      renderMessages();
      forceScrollToBottom();
      return;
    }

    showAbilityModal(ability);
  } catch (error) {
    console.error('Failed to edit ability:', error);
  }
}

async function deleteAbilityByName(name) {
  try {
    let response = await fetch(`${BASE_PATH}/api/abilities`);
    let data     = await response.json();

    let ability = data.abilities.find((a) => a.name === name && a.source === 'user');

    if (!ability) {
      state.messages.push({
        role:    'assistant',
        content: [{ type: 'text', text: `Ability "${name}" not found or cannot be deleted (only user abilities can be deleted).` }],
      });
      renderMessages();
      forceScrollToBottom();
      return;
    }

    if (!confirm(`Delete ability "${name}"?`))
      return;

    await fetch(`${BASE_PATH}/api/abilities/${ability.id}`, { method: 'DELETE' });

    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: `Ability "${name}" deleted.` }],
    });
    renderMessages();
    forceScrollToBottom();
  } catch (error) {
    console.error('Failed to delete ability:', error);
    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: 'Failed to delete ability.' }],
    });
    renderMessages();
    forceScrollToBottom();
  }
}

function showAbilityModal(ability = null) {
  elements.abilityModalError.textContent = '';
  elements.abilityForm.reset();

  if (ability) {
    elements.abilityModalTitle.textContent = 'Edit Ability';
    elements.abilityEditId.value           = ability.id;
    elements.abilityName.value             = ability.name;
    elements.abilityCategory.value         = ability.category || '';
    elements.abilityDescription.value      = ability.description || '';
    elements.abilityContent.value          = ability.content || '';
    elements.abilityAutoApprove.checked    = ability.autoApprove || false;
    elements.abilityDangerLevel.value      = ability.dangerLevel || 'safe';
  } else {
    elements.abilityModalTitle.textContent = 'Create Ability';
    elements.abilityEditId.value           = '';
  }

  elements.abilityModal.style.display = 'flex';
}

function hideAbilityModal() {
  elements.abilityModal.style.display = 'none';
}

async function handleSaveAbility(e) {
  e.preventDefault();

  let id          = elements.abilityEditId.value;
  let name        = elements.abilityName.value.trim();
  let category    = elements.abilityCategory.value.trim() || null;
  let description = elements.abilityDescription.value.trim() || null;
  let content     = elements.abilityContent.value;
  let autoApprove = elements.abilityAutoApprove.checked;
  let dangerLevel = elements.abilityDangerLevel.value;

  if (!name || !content) {
    elements.abilityModalError.textContent = 'Name and content are required.';
    return;
  }

  // Validate name format
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    elements.abilityModalError.textContent = 'Name must start with a lowercase letter and contain only lowercase letters, numbers, and underscores.';
    return;
  }

  try {
    let data = {
      name,
      type:        'process',
      category,
      description,
      content,
      autoApprove,
      dangerLevel,
    };

    if (id) {
      // Update existing
      await fetch(`${BASE_PATH}/api/abilities/${id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      });
    } else {
      // Create new
      await fetch(`${BASE_PATH}/api/abilities`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      });
    }

    hideAbilityModal();

    state.messages.push({
      role:    'assistant',
      content: [{ type: 'text', text: `Ability "${name}" ${(id) ? 'updated' : 'created'}.` }],
    });
    renderMessages();
    scrollToBottom();
  } catch (error) {
    console.error('Failed to save ability:', error);
    elements.abilityModalError.textContent = 'Failed to save ability.';
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

async function showNewAgentModal() {
  elements.newAgentError.textContent = '';
  elements.newAgentForm.reset();

  // Always refresh abilities when opening
  state.abilities = { system: [], user: [] };
  await populateAgentAbilities();

  filterModelsByType();  // Initialize model filtering
  elements.newAgentModal.style.display = 'flex';
}

function hideNewAgentModal() {
  elements.newAgentModal.style.display = 'none';
}

function filterModelsByType() {
  let agentType    = document.getElementById('agent-type').value;
  let modelSelect  = document.getElementById('agent-model');
  let claudeModels = document.getElementById('claude-models');
  let openaiModels = document.getElementById('openai-models');

  // Show/hide model optgroups based on type
  if (claudeModels)
    claudeModels.style.display = (agentType === 'claude') ? '' : 'none';

  if (openaiModels)
    openaiModels.style.display = (agentType === 'openai') ? '' : 'none';

  // Reset selection if current model doesn't match type
  let selectedOption = modelSelect.options[modelSelect.selectedIndex];
  if (selectedOption && selectedOption.parentElement) {
    let parentGroup = selectedOption.parentElement;
    if (parentGroup.id && !parentGroup.id.includes(agentType)) {
      modelSelect.value = '';
    }
  }
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
  let model  = document.getElementById('agent-model').value;
  let apiKey = document.getElementById('agent-api-key').value;
  let apiUrl = document.getElementById('agent-api-url').value.trim() || null;

  // Collect selected abilities
  let defaultAbilities = Array.from(
    elements.agentAbilitiesList.querySelectorAll('input[name="defaultAbilities"]:checked')
  ).map((cb) => cb.value);

  if (!name || !type || !apiKey) {
    elements.newAgentError.textContent = 'Please fill in all required fields';
    return;
  }

  // Build config with model if specified
  let config = {};
  if (model)
    config.model = model;

  try {
    await createAgent(name, type, apiKey, apiUrl, defaultAbilities, config);
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
    msgEl.textContent = (typeof msg.content === 'string') ? msg.content : msg.content.find((b) => b.type === 'text')?.text || '';
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
        ? `<button class="btn operation-abort" onclick="abortOperation('${op.id}')">Abort</button>`
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

function showAbilitiesModal() {
  loadAbilities().then(() => {
    renderSystemAbilities();
    renderUserAbilities();
    elements.abilitiesModal.style.display = 'flex';
  });
}

function hideAbilitiesModal() {
  elements.abilitiesModal.style.display = 'none';
}

function renderSystemAbilities() {
  if (state.abilities.system.length === 0) {
    elements.systemAbilitiesList.innerHTML = '<div class="empty-state">No system abilities available.</div>';
    return;
  }

  let html = state.abilities.system.map((a) => {
    let badgeClass, badgeText;
    if (a.type === 'function') {
      badgeClass = 'function';
      badgeText = 'function';
    } else if (a.category === 'commands') {
      badgeClass = 'command';
      badgeText = 'command';
    } else {
      badgeClass = 'ability';
      badgeText = 'ability';
    }

    return `
      <div class="ability-item">
        <div class="ability-info">
          <div class="ability-name">
            ${escapeHtml(a.name)}
            <span class="ability-type-badge ${badgeClass}">${badgeText}</span>
          </div>
          <div class="ability-description">${escapeHtml(a.description || 'No description')}</div>
        </div>
      </div>
    `;
  }).join('');

  elements.systemAbilitiesList.innerHTML = html;
}

function renderUserAbilities() {
  if (state.abilities.user.length === 0) {
    elements.userAbilitiesList.innerHTML = '<div class="empty-state">No custom abilities yet. Create one to get started.</div>';
    return;
  }

  let html = state.abilities.user.map((a) => `
    <div class="ability-item">
      <div class="ability-info">
        <div class="ability-name">
          ${escapeHtml(a.name)}
          <span class="ability-type-badge ability">ability</span>
        </div>
        <div class="ability-description">${escapeHtml(a.description || 'No description')}</div>
      </div>
      <div class="ability-actions">
        <button class="btn btn-secondary" onclick="editAbility(${a.id})">Edit</button>
        <button class="btn btn-secondary" onclick="confirmDeleteAbility(${a.id}, '${escapeHtml(a.name)}')">Delete</button>
      </div>
    </div>
  `).join('');

  elements.userAbilitiesList.innerHTML = html;
}

const ABILITY_MODAL_STORAGE_KEY = 'hero-ability-modal-draft';

function saveAbilityModalToStorage() {
  let data = {
    name:        document.getElementById('ability-name').value,
    description: document.getElementById('ability-description').value,
    applies:     document.getElementById('edit-ability-applies').value,
    content:     document.getElementById('ability-content').value,
  };
  // Only save if there's actual content
  if (data.name || data.description || data.applies || data.content) {
    sessionStorage.setItem(ABILITY_MODAL_STORAGE_KEY, JSON.stringify(data));
  }
}

function restoreAbilityModalFromStorage() {
  let stored = sessionStorage.getItem(ABILITY_MODAL_STORAGE_KEY);
  if (stored) {
    try {
      let data = JSON.parse(stored);
      document.getElementById('ability-name').value            = data.name || '';
      document.getElementById('ability-description').value     = data.description || '';
      document.getElementById('edit-ability-applies').value    = data.applies || '';
      document.getElementById('ability-content').value         = data.content || '';
    } catch (e) {
      // Ignore parse errors
    }
  }
}

function clearAbilityModalStorage() {
  sessionStorage.removeItem(ABILITY_MODAL_STORAGE_KEY);
}

function showNewAbilityModal() {
  state.editingAbilityId = null;
  elements.editAbilityTitle.textContent = 'New Ability';
  elements.editAbilityForm.reset();
  // Restore any previously saved draft
  restoreAbilityModalFromStorage();
  elements.editAbilityError.textContent = '';
  elements.editAbilityModal.style.display = 'flex';
}

function hideEditAbilityModal(clearStorage = false) {
  // Save draft if not clearing (i.e., modal closed without cancel/submit)
  if (!clearStorage && !state.editingAbilityId) {
    saveAbilityModalToStorage();
  }
  if (clearStorage) {
    clearAbilityModalStorage();
  }
  elements.editAbilityModal.style.display = 'none';
  state.editingAbilityId = null;
}

async function editAbility(id) {
  try {
    let ability = await fetchAbility(id);
    state.editingAbilityId = id;
    elements.editAbilityTitle.textContent = 'Edit Ability';
    document.getElementById('ability-name').value            = ability.name;
    document.getElementById('ability-description').value     = ability.description || '';
    document.getElementById('edit-ability-applies').value    = ability.applies || '';
    document.getElementById('ability-content').value         = ability.content;
    elements.editAbilityError.textContent = '';
    elements.editAbilityModal.style.display = 'flex';
  } catch (error) {
    console.error('Failed to load ability:', error);
  }
}

async function handleSaveUserAbility(e) {
  e.preventDefault();

  let name        = document.getElementById('ability-name').value.trim();
  let description = document.getElementById('ability-description').value.trim() || null;
  let applies     = document.getElementById('edit-ability-applies').value.trim() || null;
  let content     = document.getElementById('ability-content').value;

  // Validate name format
  if (!/^[a-z0-9_]+$/.test(name)) {
    elements.editAbilityError.textContent = 'Name must contain only lowercase letters, numbers, and underscores';
    return;
  }

  try {
    if (state.editingAbilityId) {
      await updateAbility(state.editingAbilityId, name, description, applies, content);
    } else {
      await createAbility(name, description, applies, content);
    }

    hideEditAbilityModal(true);  // Clear storage on successful save
    await loadAbilities();
    renderUserAbilities();
  } catch (error) {
    elements.editAbilityError.textContent = error.message;
  }
}

async function confirmDeleteAbility(id, name) {
  if (!confirm(`Delete ability "${name}"?`))
    return;

  try {
    await deleteAbility(id);
    await loadAbilities();
    renderUserAbilities();
  } catch (error) {
    console.error('Failed to delete ability:', error);
  }
}

function switchAbilityTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  document.querySelectorAll('.tab-content').forEach((content) => {
    content.classList.toggle('active', content.id === `abilities-tab-${tab}`);
  });
}

async function populateAgentAbilities() {
  await loadAbilities();

  let allAbilities = [
    ...state.abilities.system.map((a) => ({ ...a, type: 'system' })),
    ...state.abilities.user.map((a) => ({ ...a, type: 'user' })),
  ];

  if (allAbilities.length === 0) {
    elements.agentAbilitiesList.innerHTML = '<div class="empty-state">No abilities available.</div>';
    return;
  }

  // Add Select All checkbox at the top
  let html = `
    <div class="select-all-container">
      <label class="checkbox-item">
        <input type="checkbox" id="select-all-abilities" onchange="toggleAllAbilities(this.checked)">
        <span><strong>Select All</strong></span>
      </label>
    </div>
  `;

  html += allAbilities.map((a) => `
    <label class="checkbox-item">
      <input type="checkbox" name="defaultAbilities" value="${escapeHtml(a.name)}" onchange="updateSelectAllState()">
      <span>${escapeHtml(a.name)}</span>
      <span class="ability-type">${a.type}</span>
    </label>
  `).join('');

  elements.agentAbilitiesList.innerHTML = html;
}

function toggleAllAbilities(checked) {
  let checkboxes = elements.agentAbilitiesList.querySelectorAll('input[name="defaultAbilities"]');
  for (let cb of checkboxes)
    cb.checked = checked;
}

function updateSelectAllState() {
  let checkboxes = elements.agentAbilitiesList.querySelectorAll('input[name="defaultAbilities"]');
  let selectAll  = document.getElementById('select-all-abilities');

  if (!selectAll)
    return;

  let allChecked  = Array.from(checkboxes).every((cb) => cb.checked);
  let someChecked = Array.from(checkboxes).some((cb) => cb.checked);

  selectAll.checked       = allChecked;
  selectAll.indeterminate = someChecked && !allChecked;
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
    elements.agentsList.innerHTML = '<div class="empty-state">No agents configured yet. Add one to get started.</div>';
    return;
  }

  let html = state.agents.map((agent) => {
    // Get model from config if available
    let model = agent.config?.model || 'default';

    return `
      <div class="agent-item">
        <div class="agent-info">
          <div class="agent-name">${escapeHtml(agent.name)}</div>
          <div class="agent-meta">
            <span class="agent-type">${escapeHtml(agent.type)}</span>
            <span class="agent-model">${escapeHtml(model)}</span>
          </div>
        </div>
        <div class="agent-actions">
          <button class="btn btn-secondary btn-sm" onclick="showAgentConfigModal(${agent.id})">Config</button>
          <button class="btn btn-secondary btn-sm" onclick="confirmDeleteAgent(${agent.id}, '${escapeHtml(agent.name)}')">Delete</button>
        </div>
      </div>
    `;
  }).join('');

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

// Modals
elements.newSessionForm.addEventListener('submit', handleCreateSession);
elements.cancelNewSession.addEventListener('click', hideNewSessionModal);
elements.newAgentForm.addEventListener('submit', handleCreateAgent);
elements.cancelNewAgent.addEventListener('click', hideNewAgentModal);

// Agent type change - filter models
let agentTypeSelect = document.getElementById('agent-type');
if (agentTypeSelect)
  agentTypeSelect.addEventListener('change', filterModelsByType);

// Close modals on overlay click
elements.newSessionModal.addEventListener('click', (e) => {
  if (e.target === elements.newSessionModal)
    hideNewSessionModal();
});
elements.newAgentModal.addEventListener('click', (e) => {
  if (e.target === elements.newAgentModal)
    hideNewAgentModal();
});

// Abilities
elements.abilitiesBtn.addEventListener('click', showAbilitiesModal);
elements.closeAbilitiesModal.addEventListener('click', hideAbilitiesModal);
elements.abilitiesModal.addEventListener('click', (e) => {
  if (e.target === elements.abilitiesModal)
    hideAbilitiesModal();
});
elements.newAbilityBtn.addEventListener('click', showNewAbilityModal);

// Abilities tab switching
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchAbilityTab(btn.dataset.tab));
});

// Edit Ability Modal
elements.editAbilityForm.addEventListener('submit', handleSaveUserAbility);
elements.cancelEditAbility.addEventListener('click', () => hideEditAbilityModal(true));
elements.editAbilityModal.addEventListener('click', (e) => {
  if (e.target === elements.editAbilityModal)
    hideEditAbilityModal();
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

// Ability Modal
if (elements.abilityForm) {
  elements.abilityForm.addEventListener('submit', handleSaveAbility);
  elements.cancelAbilityModal.addEventListener('click', hideAbilityModal);
  elements.abilityModal.addEventListener('click', (e) => {
    if (e.target === elements.abilityModal)
      hideAbilityModal();
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
// Initialize
// ============================================================================

handleRoute();
