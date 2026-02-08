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
} from './hero-base.js';

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
   * Component mounted.
   */
  mounted() {
    // Subscribe to session changes
    this.#unsubscribers.push(
      this.subscribeGlobal('currentSession', ({ value }) => {
        if (value) {
          this.#loadSession(value);
        } else {
          this.#clearSession();
        }
      })
    );

    // Setup scroll listener
    let container = this.querySelector('.chat-main');
    if (container) {
      container.addEventListener('scroll', () => this.#updateScrollButton());
    }

    this.render();
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

  /**
   * Load session messages.
   * @param {object} session
   */
  #loadSession(session) {
    this.#messages = session.messages || [];
    this.render();
    this.scrollToBottom();
  }

  /**
   * Clear session state.
   */
  #clearSession() {
    this.#messages = [];
    this.#streamingMessage = null;
    this.render();
  }

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

  /**
   * Check if near bottom of scroll.
   * @returns {boolean}
   */
  isNearBottom() {
    let container = this.querySelector('.chat-main');
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
      let container = this.querySelector('.chat-main');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
      this.#updateScrollButton();
    });
  }

  /**
   * Update scroll button visibility.
   */
  #updateScrollButton() {
    let btn = this.querySelector('.scroll-to-bottom');
    if (btn) {
      btn.style.display = this.isNearBottom() ? 'none' : 'flex';
    }
  }

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
        this.#doRender();
      }, this.#RENDER_MAX_WAIT_MS);
    }

    this.#renderDebounceTimer = setTimeout(() => {
      this.#doRender();
    }, this.#RENDER_DEBOUNCE_MS);
  }

  /**
   * Actual render implementation.
   */
  #doRender() {
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
      this.innerHTML = '<div class="no-session">Select a session to start chatting</div>';
      return;
    }

    let messagesHtml = this.visibleMessages.map((m) => this.#renderMessage(m)).join('');

    // Add streaming message if present
    let streamingHtml = '';
    if (this.#streamingMessage) {
      streamingHtml = this.#renderStreamingMessage();
    }

    this.innerHTML = `
      <div class="chat-header">
        <h2 class="session-title">${escapeHtml(session.name)}</h2>
        <div class="chat-actions">
          <button class="toggle-hidden" onclick="this.closest('hero-chat').toggleHiddenMessages()">
            ${this.#showHiddenMessages ? 'Hide' : 'Show'} hidden
          </button>
        </div>
      </div>
      <div class="chat-main">
        <div class="messages">
          ${messagesHtml}
          ${streamingHtml}
        </div>
      </div>
      <button class="scroll-to-bottom" style="display: none" onclick="this.closest('hero-chat').forceScrollToBottom()">
        ↓
      </button>
    `;

    // Re-attach scroll listener
    let container = this.querySelector('.chat-main');
    if (container) {
      container.addEventListener('scroll', () => this.#updateScrollButton());
    }
  }

  /**
   * Render a single message.
   * @param {object} message
   * @returns {string}
   */
  #renderMessage(message) {
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
    let contentHtml = this.#renderContent(message);

    // Token estimate
    let tokenEstimate = this.#estimateTokens(message);
    let timestampHtml = this.#renderTimestamp(message, tokenEstimate);

    return `
      <div class="message ${roleClass}${queuedClass}${hiddenClass}${errorClass}"
           data-message-id="${messageId}"
           id="${(messageId) ? `msg-${messageId}` : ''}">
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
  #renderContent(message) {
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
      return `<div class="message-content">${this.#renderMarkup(message.content)}</div>`;
    }

    // Array content
    if (Array.isArray(message.content)) {
      let html = '';
      for (let block of message.content) {
        if (block.type === 'text') {
          html += `<div class="message-content">${this.#renderMarkup(block.text)}</div>`;
        } else if (block.type === 'tool_use') {
          html += this.#renderToolUse(block);
        } else if (block.type === 'tool_result') {
          html += this.#renderToolResult(block);
        }
      }
      return html;
    }

    return '';
  }

  /**
   * Render markup (placeholder - will use external renderer).
   * @param {string} text
   * @returns {string}
   */
  #renderMarkup(text) {
    // For now, just escape HTML - will integrate with markup.js
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  /**
   * Render tool use block.
   * @param {object} block
   * @returns {string}
   */
  #renderToolUse(block) {
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
  #renderToolResult(block) {
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
  #renderStreamingMessage() {
    let streaming = this.#streamingMessage;

    return `
      <div class="message message-assistant streaming" id="streaming-message">
        <div class="message-header">${this.agentName}</div>
        <div class="message-bubble">
          <div class="message-content">${this.#renderMarkup(streaming.content || '')}</div>
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
  #estimateTokens(message) {
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
  #renderTimestamp(message, tokenEstimate) {
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
if (typeof customElements !== 'undefined') {
  customElements.define(HeroChat.tagName, HeroChat);
}
