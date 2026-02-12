'use strict';

/**
 * Hero Chat - Message Display Component
 *
 * Displays:
 * - Message list with user/assistant messages
 * - Tool use and results
 * - Streaming message support
 * - Scroll-to-bottom button
 */

import {
  HeroComponent,
  GlobalState,
  DynamicProperty,
} from '../hero-base.js';

// ============================================================================
// Helper Functions
// ============================================================================

function escapeHtml(text) {
  let div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatRelativeDate(dateString) {
  let date    = new Date(dateString);
  let now     = new Date();
  let diffMs  = now - date;
  let diffMin = Math.floor(diffMs / 60000);
  let diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 5) return 'just now';

  let timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (diffDay < 1 && date.getDate() === now.getDate()) return timeStr;
  if (diffDay < 2 && date.getDate() === now.getDate() - 1) return `yesterday ${timeStr}`;

  if (diffDay < 7) {
    let dayName = date.toLocaleDateString([], { weekday: 'short' });
    return `${dayName} ${timeStr}`;
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` ${timeStr}`;
}

function formatTokenCount(tokens) {
  if (tokens < 1000) return tokens.toString();
  if (tokens < 10000) return (tokens / 1000).toFixed(1) + 'k';
  return Math.round(tokens / 1000) + 'k';
}

// ============================================================================
// HeroChat Component
// ============================================================================

export class HeroChat extends HeroComponent {
  static tagName = 'hero-chat';

  // Component state (session-level)
  #messages = [];
  #showHiddenMessages = false;
  #streamingMessage = null;
  #unsubscribers = [];
  #scrollThreshold = 100;

  // Debounce state
  #renderDebounceTimer = null;
  #renderMaxWaitTimer = null;
  #renderPending = false;
  #RENDER_DEBOUNCE_MS = 16;
  #RENDER_MAX_WAIT_MS = 100;

  // ---------------------------------------------------------------------------
  // Shadow DOM
  // ---------------------------------------------------------------------------

  createShadowDOM() {
    return this.attachShadow({ mode: 'open' });
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /**
   * Get visible messages (filtered by hidden state).
   * @returns {Array}
   */
  get visibleMessages() {
    return (this.#showHiddenMessages)
      ? this.#messages
      : this.#messages.filter((m) => !m.hidden);
  }

  /**
   * Get current session.
   * @returns {object|null}
   */
  get session() {
    return GlobalState.currentSession.valueOf();
  }

  /**
   * Get agent name for labels.
   * @returns {string}
   */
  get agentName() {
    return this.session?.agent?.name || 'Assistant';
  }

  /**
   * Get the messages container element (for external insertions).
   * @returns {HTMLElement|null}
   */
  get $messages() {
    return this.shadowRoot?.querySelector('.messages');
  }

  /**
   * Get the innerHTML of the messages container (for compatibility).
   * @returns {string}
   */
  get messagesHTML() {
    let msgs = this.$messages;
    return (msgs) ? msgs.innerHTML : '';
  }

  /**
   * Set innerHTML of the messages container (for compatibility).
   * @param {string} html
   */
  set messagesHTML(html) {
    let msgs = this.$messages;
    if (msgs) {
      msgs.innerHTML = html;
    }
  }

  /**
   * Insert HTML adjacent to messages (for compatibility with approval/question UI).
   * @param {string} position - 'beforeend', 'afterbegin', etc.
   * @param {string} html
   */
  insertMessagesHTML(position, html) {
    let msgs = this.$messages;
    if (msgs) {
      msgs.insertAdjacentHTML(position, html);
      this.scrollToBottom();
    }
  }

  /**
   * Append a child element to messages (for compatibility).
   * @param {Node} child
   * @returns {Node}
   */
  appendToMessages(child) {
    let msgs = this.$messages;
    if (msgs) {
      let result = msgs.appendChild(child);
      this.scrollToBottom();
      return result;
    }
    return child;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Component mounted.
   */
  mounted() {
    // Subscribe to session changes
    this.#unsubscribers.push(
      this.subscribeGlobal('currentSession', ({ value }) => {
        if (value) {
          this._loadSession(value);
        } else {
          this._clearSession();
        }
      })
    );

    // Setup scroll listener on parent .chat-main
    let container = this.closest('.chat-main');
    if (container) {
      container.addEventListener('scroll', () => this._updateScrollButton());
    }

    // Check if session already exists (subscription won't fire for existing value)
    let existingSession = this.session;
    if (existingSession) {
      this._loadSession(existingSession);
    } else {
      this.render();
    }
  }

  /**
   * Component unmounted.
   */
  unmounted() {
    for (let unsub of this.#unsubscribers) {
      unsub();
    }
    this.#unsubscribers = [];

    if (this.#renderDebounceTimer) clearTimeout(this.#renderDebounceTimer);
    if (this.#renderMaxWaitTimer) clearTimeout(this.#renderMaxWaitTimer);
  }

  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------

  /**
   * Load session messages.
   * @param {object} session
   */
  _loadSession(session) {
    this.#messages = session.messages || [];
    this.render();
    this.scrollToBottom();
  }

  /**
   * Clear session state.
   */
  _clearSession() {
    this.#messages = [];
    this.#streamingMessage = null;
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Public Methods
  // ---------------------------------------------------------------------------

  /**
   * Set messages array.
   * @param {Array} messages
   */
  setMessages(messages) {
    this.#messages = messages;
    this.renderDebounced();
  }

  /**
   * Add a message.
   * @param {object} message
   */
  addMessage(message) {
    this.#messages.push(message);
    this.renderDebounced();
    this.scrollToBottom();
  }

  /**
   * Set streaming message state.
   * @param {object|null} streaming
   */
  setStreaming(streaming) {
    this.#streamingMessage = streaming;
    this.renderDebounced();
    this.scrollToBottom();
  }

  /**
   * Toggle show hidden messages.
   */
  toggleHiddenMessages() {
    this.#showHiddenMessages = !this.#showHiddenMessages;
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Scroll Management
  // ---------------------------------------------------------------------------

  /**
   * Get the scrollable container (parent .chat-main).
   * @returns {HTMLElement|null}
   */
  _getScrollContainer() {
    return this.closest('.chat-main');
  }

  /**
   * Check if near bottom of scroll.
   * @returns {boolean}
   */
  isNearBottom() {
    let container = this._getScrollContainer();
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight < this.#scrollThreshold;
  }

  /**
   * Scroll to bottom if near bottom (auto-follow).
   */
  scrollToBottom() {
    if (this.isNearBottom()) {
      this.forceScrollToBottom();
    }
  }

  /**
   * Force scroll to bottom.
   */
  forceScrollToBottom() {
    requestAnimationFrame(() => {
      let container = this._getScrollContainer();
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
      this._updateScrollButton();
    });
  }

  /**
   * Update scroll button visibility.
   */
  _updateScrollButton() {
    let button = this.shadowRoot?.querySelector('.scroll-to-bottom');
    if (button) {
      button.style.display = this.isNearBottom() ? 'none' : 'flex';
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /**
   * Debounced render to prevent rapid re-renders.
   */
  renderDebounced() {
    if (this.#renderDebounceTimer) {
      clearTimeout(this.#renderDebounceTimer);
    }

    if (!this.#renderPending) {
      this.#renderPending = true;
      this.#renderMaxWaitTimer = setTimeout(() => {
        this._doRender();
      }, this.#RENDER_MAX_WAIT_MS);
    }

    this.#renderDebounceTimer = setTimeout(() => {
      this._doRender();
    }, this.#RENDER_DEBOUNCE_MS);
  }

  /**
   * Actual render implementation.
   */
  _doRender() {
    this.#renderPending = false;

    if (this.#renderDebounceTimer) {
      clearTimeout(this.#renderDebounceTimer);
      this.#renderDebounceTimer = null;
    }
    if (this.#renderMaxWaitTimer) {
      clearTimeout(this.#renderMaxWaitTimer);
      this.#renderMaxWaitTimer = null;
    }

    this.render();
  }

  /**
   * Render the component.
   */
  render() {
    let session = this.session;

    if (!session) {
      // Render empty state
      this.shadowRoot.innerHTML = `
        ${this._getStyles()}
        <div class="messages messages-container">
          <div class="no-session">Select a session to start chatting</div>
        </div>
      `;
      return;
    }

    let messagesHtml = this.visibleMessages.map((m) => this._renderMessage(m)).join('');

    // Add streaming message if present
    let streamingHtml = '';
    if (this.#streamingMessage) {
      streamingHtml = this._renderStreamingMessage();
    }

    // Render to shadow DOM
    this.shadowRoot.innerHTML = `
      ${this._getStyles()}
      <div class="messages messages-container">
        ${messagesHtml}
        ${streamingHtml}
      </div>
      <button class="scroll-to-bottom" style="display: none">↓</button>
    `;

    // Bind scroll button click
    let scrollBtn = this.shadowRoot.querySelector('.scroll-to-bottom');
    if (scrollBtn) {
      scrollBtn.onclick = () => this.forceScrollToBottom();
    }

    // Manually trigger render on hml-prompt elements (connectedCallback may not fire in shadow DOM)
    queueMicrotask(() => {
      let hmlPrompts = this.shadowRoot.querySelectorAll('hml-prompt');
      hmlPrompts.forEach((prompt) => {
        if (typeof prompt.render === 'function' && prompt.shadowRoot) {
          // Only render if shadow root is empty (not already rendered)
          if (!prompt.shadowRoot.innerHTML) {
            prompt._renderCount = 0;
            prompt._isRendering = false;
            prompt.render();
          }
        }
      });
    });
  }

  /**
   * Get styles for shadow DOM.
   * @returns {string}
   */
  _getStyles() {
    return `<style>
      :host {
        display: block;
        flex: 1;
        overflow-y: auto;
        position: relative;
      }

      .messages-container {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 16px;
        min-height: 100%;
      }

      .no-session {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: var(--text-muted, #6b7280);
        font-size: 16px;
      }

      .message {
        display: flex;
        flex-direction: column;
        max-width: 85%;
      }

      .message-user { align-self: flex-end; }
      .message-assistant { align-self: flex-start; }

      .message-header {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-muted, #6b7280);
        margin-bottom: 4px;
        padding: 0 8px;
      }

      .message-bubble {
        padding: 12px 16px;
        border-radius: var(--radius-lg, 12px);
        background: var(--bg-tertiary, #2a2a3e);
        color: var(--text-primary, #e0e0e0);
        word-wrap: break-word;
      }

      .message-user .message-bubble {
        background: var(--accent, #f472b6);
        color: white;
        border-bottom-right-radius: 4px;
      }

      .message-assistant .message-bubble {
        border-bottom-left-radius: 4px;
      }

      .message-hidden { opacity: 0.6; }
      .message-hidden .message-bubble {
        border: 1px dashed var(--border-color, #2d2d2d);
        background: transparent;
      }

      .message-queued .message-bubble {
        opacity: 0.7;
        border: 1px dashed var(--text-muted, #6b7280);
      }

      .queued-badge, .type-badge {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 10px;
        margin-left: 6px;
        text-transform: uppercase;
        font-weight: 500;
      }

      .queued-badge { background: var(--warning, #f59e0b); color: #1a1a2e; }
      .type-badge { background: var(--bg-secondary, #1a1a2e); color: var(--text-muted, #6b7280); }

      .message-error .message-bubble {
        background: rgba(248, 113, 113, 0.1);
        border: 1px solid var(--error, #f87171);
      }

      .streaming-error {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--error, #f87171);
      }

      .error-icon { font-size: 18px; }

      .message-content { line-height: 1.5; }
      .message-content p { margin: 0 0 8px 0; }
      .message-content p:last-child { margin-bottom: 0; }

      .message-content code {
        background: rgba(0, 0, 0, 0.2);
        padding: 2px 6px;
        border-radius: 4px;
        font-family: monospace;
        font-size: 0.9em;
      }

      .message-content pre {
        background: rgba(0, 0, 0, 0.3);
        padding: 12px;
        border-radius: 6px;
        overflow-x: auto;
        margin: 8px 0;
      }

      .message-content pre code { background: none; padding: 0; }

      .message-timestamp {
        font-size: 11px;
        color: var(--text-muted, #6b7280);
        margin-top: 4px;
        padding: 0 8px;
      }

      .tool-call {
        margin: 8px 0;
        border: 1px solid var(--border-color, #2d2d2d);
        border-radius: var(--radius-sm, 4px);
        overflow: hidden;
      }

      .tool-call-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: var(--bg-secondary, #1a1a2e);
        font-weight: 500;
        font-size: 13px;
      }

      .tool-call-body { padding: 8px 12px; }
      .tool-call-section { margin-bottom: 8px; }
      .tool-call-section:last-child { margin-bottom: 0; }

      .tool-call-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted, #6b7280);
        text-transform: uppercase;
        margin-bottom: 4px;
      }

      .tool-call-content {
        font-family: monospace;
        font-size: 12px;
        background: rgba(0, 0, 0, 0.2);
        padding: 8px;
        border-radius: 4px;
        white-space: pre-wrap;
        overflow-x: auto;
        max-height: 200px;
        overflow-y: auto;
      }

      .streaming .typing-indicator {
        display: flex;
        gap: 4px;
        padding-top: 8px;
      }

      .typing-indicator span {
        width: 6px;
        height: 6px;
        background: var(--text-muted, #6b7280);
        border-radius: 50%;
        animation: typing 1.4s infinite;
      }

      .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
      .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }

      @keyframes typing {
        0%, 60%, 100% { transform: translateY(0); }
        30% { transform: translateY(-4px); }
      }

      .scroll-to-bottom {
        position: absolute;
        bottom: 20px;
        right: 20px;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: var(--accent, #f472b6);
        color: white;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        transition: transform 0.2s, opacity 0.2s;
        z-index: 100;
      }

      .scroll-to-bottom:hover { transform: scale(1.1); }
    </style>`;
  }

  /**
   * Render a single message.
   * @param {object} message
   * @returns {string}
   */
  _renderMessage(message) {
    let roleClass   = (message.role === 'user') ? 'message-user' : 'message-assistant';
    let roleLabel   = (message.role === 'user') ? 'You' : this.agentName;
    let messageId   = message.id || '';
    let queuedClass = (message.queued) ? ' message-queued' : '';
    let hiddenClass = (message.hidden) ? ' message-hidden' : '';
    let errorClass  = (message.type === 'error') ? ' message-error' : '';

    // Type badge for hidden messages
    let typeBadge = '';
    if (message.hidden && message.type) {
      let typeLabels = { system: 'System', interaction: 'Interaction', feedback: 'Feedback' };
      let label = typeLabels[message.type] || message.type;
      typeBadge = `<span class="type-badge type-${message.type}">${label}</span>`;
    }

    let queuedBadge = (message.queued) ? '<span class="queued-badge">Queued</span>' : '';

    // Render content
    let contentHtml = this._renderContent(message);

    // Token estimate
    let tokenEstimate = this._estimateTokens(message);
    let timestampHtml = this._renderTimestamp(message, tokenEstimate);

    return `
      <div class="message ${roleClass}${queuedClass}${hiddenClass}${errorClass}"
           data-message-id="${messageId}"
           id="${(messageId) ? `message-${messageId}` : ''}">
        <div class="message-header">${roleLabel} ${queuedBadge}${typeBadge}</div>
        <div class="message-bubble">
          ${contentHtml}
        </div>
        ${timestampHtml}
      </div>
    `;
  }

  /**
   * Render message content.
   * @param {object} message
   * @returns {string}
   */
  _renderContent(message) {
    // Error messages
    if (message.type === 'error') {
      let errorText = (typeof message.content === 'string') ? message.content : 'An error occurred';
      return `
        <div class="streaming-error">
          <span class="error-icon">⚠</span>
          <span class="error-text">${escapeHtml(errorText)}</span>
        </div>
      `;
    }

    // String content
    if (typeof message.content === 'string') {
      return `<div class="message-content">${this._renderMarkup(message.content)}</div>`;
    }

    // Array content
    if (Array.isArray(message.content)) {
      let html = '';
      for (let block of message.content) {
        if (block.type === 'text') {
          html += `<div class="message-content">${this._renderMarkup(block.text)}</div>`;
        } else if (block.type === 'tool_use') {
          html += this._renderToolUse(block);
        } else if (block.type === 'tool_result') {
          html += this._renderToolResult(block);
        }
      }
      return html;
    }

    return '';
  }

  /**
   * Render markup using HML renderer.
   * @param {string} text
   * @returns {string}
   */
  _renderMarkup(text) {
    // Use global renderMarkup from markup.js if available
    if (typeof window.renderMarkup === 'function') {
      return window.renderMarkup(text);
    }
    // Fallback: escape HTML
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  /**
   * Render tool use block.
   * @param {object} block
   * @returns {string}
   */
  _renderToolUse(block) {
    return `
      <div class="tool-call">
        <div class="tool-call-header">
          <span class="tool-call-icon">⚙</span>
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

  /**
   * Render tool result block.
   * @param {object} block
   * @returns {string}
   */
  _renderToolResult(block) {
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

  /**
   * Render streaming message.
   * @returns {string}
   */
  _renderStreamingMessage() {
    let streaming = this.#streamingMessage;

    return `
      <div class="message message-assistant streaming" id="streaming-message">
        <div class="message-header">${this.agentName}</div>
        <div class="message-bubble">
          <div class="message-content">${this._renderMarkup(streaming.content || '')}</div>
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Estimate token count for a message.
   * @param {object} message
   * @returns {number}
   */
  _estimateTokens(message) {
    let estimate = 0;

    if (typeof message.content === 'string') {
      estimate = Math.ceil(message.content.length / 4);
    } else if (Array.isArray(message.content)) {
      for (let block of message.content) {
        if (block.type === 'text') {
          estimate += Math.ceil(block.text.length / 4);
        }
      }
    }

    return estimate;
  }

  /**
   * Render timestamp with token count.
   * @param {object} message
   * @param {number} tokenEstimate
   * @returns {string}
   */
  _renderTimestamp(message, tokenEstimate) {
    if (message.createdAt) {
      let timeStr  = formatRelativeDate(message.createdAt);
      let tokenStr = formatTokenCount(tokenEstimate);
      return `<div class="message-timestamp">${timeStr} · ~${tokenStr} tokens</div>`;
    } else if (tokenEstimate > 0) {
      let tokenStr = formatTokenCount(tokenEstimate);
      return `<div class="message-timestamp">~${tokenStr} tokens</div>`;
    }
    return '';
  }
}

// Register the component
HeroChat.register();
