'use strict';

/**
 * Hero Input - Message Input Component
 *
 * Features:
 * - Auto-resizing textarea
 * - Command detection (/ prefix)
 * - Queue support when busy
 * - Keyboard shortcuts (Enter to send, Shift+Enter for newline)
 */

import {
  HeroComponent,
  GlobalState,
  DynamicProperty,
} from './hero-base.js';

// ============================================================================
// HeroInput Component
// ============================================================================

export class HeroInput extends HeroComponent {
  static tagName = 'hero-input';

  // Component state
  #isLoading = false;
  #streamingMode = true;
  #messageQueue = [];
  #maxHeight = 150;
  #unsubscribers = [];

  /**
   * Get the textarea element.
   * @returns {HTMLTextAreaElement|null}
   */
  get textarea() {
    return this.querySelector('textarea');
  }

  /**
   * Get current input value.
   * @returns {string}
   */
  get value() {
    return this.textarea?.value || '';
  }

  /**
   * Set input value.
   * @param {string} val
   */
  set value(val) {
    if (this.textarea) {
      this.textarea.value = val;
      this.#autoResize();
    }
  }

  /**
   * Check if currently loading.
   * @returns {boolean}
   */
  get loading() {
    return this.#isLoading;
  }

  /**
   * Set loading state.
   * @param {boolean} val
   */
  set loading(val) {
    this.#isLoading = val;
    this.#updateButtonState();
  }

  /**
   * Component mounted.
   */
  mounted() {
    this.render();

    // Subscribe to session changes
    this.#unsubscribers.push(
      this.subscribeGlobal('currentSession', () => {
        this.#updateButtonState();
        this.focus();
      })
    );
  }

  /**
   * Component unmounted.
   */
  unmounted() {
    for (let unsub of this.#unsubscribers) {
      unsub();
    }
    this.#unsubscribers = [];
  }

  /**
   * Focus the textarea.
   */
  focus() {
    this.textarea?.focus();
  }

  /**
   * Clear the input.
   */
  clear() {
    if (this.textarea) {
      this.textarea.value = '';
      this.textarea.style.height = 'auto';
    }
  }

  /**
   * Handle send action.
   */
  async handleSend() {
    let content = this.value.trim();

    if (!content) return;
    if (!this.currentSession) return;

    // Clear input immediately
    this.clear();

    // Check for commands
    if (content.startsWith('/')) {
      this.dispatchEvent(new CustomEvent('command', {
        detail: { command: content },
        bubbles: true,
      }));
      this.focus();
      return;
    }

    // If busy, queue the message
    if (this.#isLoading) {
      this.#queueMessage(content);
      this.focus();
      return;
    }

    // Send the message
    await this.#sendMessage(content);
  }

  /**
   * Queue a message for later processing.
   * @param {string} content
   */
  #queueMessage(content) {
    let queueId = `queued-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    this.#messageQueue.push({ id: queueId, content });

    this.dispatchEvent(new CustomEvent('queued', {
      detail: { content, queueId },
      bubbles: true,
    }));
  }

  /**
   * Send a message.
   * @param {string} content
   */
  async #sendMessage(content) {
    this.loading = true;

    try {
      this.dispatchEvent(new CustomEvent('send', {
        detail: {
          content,
          streaming: this.#streamingMode,
          sessionId: this.currentSession.id,
        },
        bubbles: true,
      }));
    } finally {
      // Note: loading will be set to false by parent after response
    }
  }

  /**
   * Process queued messages.
   */
  async processQueue() {
    while (this.#messageQueue.length > 0 && !this.#isLoading) {
      let queued = this.#messageQueue.shift();

      this.dispatchEvent(new CustomEvent('queue-process', {
        detail: { content: queued.content, queueId: queued.id },
        bubbles: true,
      }));

      // Wait for message to complete (parent should call done())
      await new Promise((resolve) => {
        this.addEventListener('queue-complete', resolve, { once: true });
      });
    }
  }

  /**
   * Signal queue item complete.
   */
  queueComplete() {
    this.dispatchEvent(new CustomEvent('queue-complete'));
  }

  /**
   * Handle keydown events.
   * @param {KeyboardEvent} e
   */
  #handleKeydown(e) {
    // Enter without Shift sends message
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.handleSend();
      return;
    }

    // Escape clears input
    if (e.key === 'Escape') {
      this.clear();
      return;
    }
  }

  /**
   * Auto-resize textarea based on content.
   */
  #autoResize() {
    let textarea = this.textarea;
    if (!textarea) return;

    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, this.#maxHeight) + 'px';
  }

  /**
   * Update send button state.
   */
  #updateButtonState() {
    let btn = this.querySelector('.send-btn');
    if (btn) {
      btn.disabled = this.#isLoading || !this.currentSession;
    }
  }

  /**
   * Render the component.
   */
  render() {
    let disabled = !this.currentSession;

    this.innerHTML = `
      <div class="input-container">
        <textarea
          class="message-input"
          placeholder="${disabled ? 'Select a session to start...' : 'Type a message...'}"
          ${disabled ? 'disabled' : ''}
        ></textarea>
        <button class="send-btn" ${disabled || this.#isLoading ? 'disabled' : ''}>
          Send
        </button>
        <button class="clear-btn">
          Clear
        </button>
      </div>
    `;

    // Attach event listeners
    let textarea = this.textarea;
    if (textarea) {
      textarea.addEventListener('keydown', (e) => this.#handleKeydown(e));
      textarea.addEventListener('input', () => this.#autoResize());
    }

    let sendBtn = this.querySelector('.send-btn');
    if (sendBtn) {
      sendBtn.addEventListener('click', () => this.handleSend());
    }

    let clearBtn = this.querySelector('.clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('clear', { bubbles: true }));
      });
    }
  }
}

// Register the component
if (typeof customElements !== 'undefined') {
  customElements.define(HeroInput.tagName, HeroInput);
}
