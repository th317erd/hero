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
} from '../hero-base.js';

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
  #pendingFiles = [];

  // ---------------------------------------------------------------------------
  // Shadow DOM
  // ---------------------------------------------------------------------------

  createShadowDOM() {
    return this.attachShadow({ mode: 'open' });
  }

  // ---------------------------------------------------------------------------
  // Template Expression Getters
  // ---------------------------------------------------------------------------

  /**
   * Get placeholder text based on session state.
   * @returns {string}
   */
  get placeholder() {
    return this.currentSession ? 'Type a message...' : 'Select a session to start...';
  }

  // ---------------------------------------------------------------------------
  // Element Accessors
  // ---------------------------------------------------------------------------

  /**
   * Get the textarea element.
   * @returns {HTMLTextAreaElement|null}
   */
  get textarea() {
    return this.shadowRoot?.querySelector('textarea');
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
      this.autoResize();
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
    this._updateButtonState();
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
      this.subscribeGlobal('currentSession', () => {
        this._updateDisabledState();
        this._updateButtonState();
        this.focus();
      })
    );

    // Initial state update
    this._updateDisabledState();
    this._updateButtonState();
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

  // ---------------------------------------------------------------------------
  // Public Methods
  // ---------------------------------------------------------------------------

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
   * Process queued messages.
   */
  async processQueue() {
    while (this.#messageQueue.length > 0 && !this.#isLoading) {
      let queued = this.#messageQueue.shift();

      this.dispatchEvent(new CustomEvent('hero:queue-process', {
        detail: { content: queued.content, queueId: queued.id },
        bubbles: true,
        composed: true,
      }));

      // Wait for message to complete (parent should call done())
      await new Promise((resolve) => {
        this.addEventListener('hero:queue-complete', resolve, { once: true });
      });
    }
  }

  /**
   * Signal queue item complete.
   */
  queueComplete() {
    this.dispatchEvent(new CustomEvent('hero:queue-complete'));
  }

  // ---------------------------------------------------------------------------
  // Event Handlers (called from template)
  // ---------------------------------------------------------------------------

  /**
   * Handle send action.
   */
  async handleSend() {
    let content = this.value.trim();

    if (!content) return;
    if (!this.currentSession) return;

    // Clear input immediately
    this.clear();

    // Commands are now handled server-side - send them like regular messages
    // The server will intercept /command patterns and execute them

    // If busy, queue the message
    if (this.#isLoading) {
      this._queueMessage(content);
      this.focus();
      return;
    }

    // Send the message (commands and regular messages are handled the same way)
    await this._sendMessage(content);
  }

  /**
   * Handle keydown events.
   * @param {KeyboardEvent} e
   */
  handleKeydown(e) {
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
  autoResize() {
    let textarea = this.textarea;
    if (!textarea) return;

    textarea.style.height = 'auto';
    let newHeight = Math.min(textarea.scrollHeight, this.#maxHeight);
    textarea.style.height = newHeight + 'px';

    // Enable scrolling when content exceeds max height
    textarea.style.overflowY = (textarea.scrollHeight > this.#maxHeight) ? 'auto' : 'hidden';
  }

  /**
   * Handle dragover event.
   * @param {DragEvent} e
   */
  handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    let overlay = this.shadowRoot?.querySelector('.drop-overlay');
    if (overlay) overlay.classList.add('active');
  }

  /**
   * Handle dragleave event.
   * @param {DragEvent} e
   */
  handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    let overlay = this.shadowRoot?.querySelector('.drop-overlay');
    if (overlay) overlay.classList.remove('active');
  }

  /**
   * Handle file drop.
   * @param {DragEvent} e
   */
  handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    let overlay = this.shadowRoot?.querySelector('.drop-overlay');
    if (overlay) overlay.classList.remove('active');

    let files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0)
      this._addFiles(files);
  }

  /**
   * Handle paste event (for pasted images).
   * @param {ClipboardEvent} e
   */
  handlePaste(e) {
    let items = Array.from(e.clipboardData?.items || []);
    let files = items
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter(Boolean);

    if (files.length > 0) {
      e.preventDefault();
      this._addFiles(files);
    }
  }

  /**
   * Get pending files for the current message.
   * @returns {File[]}
   */
  get pendingFiles() {
    return [...this.#pendingFiles];
  }

  /**
   * Clear pending files after upload.
   */
  clearFiles() {
    this.#pendingFiles = [];
    this._renderFilePreview();
  }

  /**
   * Handle clear button click.
   */
  handleClear() {
    this.dispatchEvent(new CustomEvent('hero:clear', {
      bubbles: true,
      composed: true,
    }));
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  /**
   * Queue a message for later processing.
   * @param {string} content
   */
  _queueMessage(content) {
    let queueId = `queued-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    this.#messageQueue.push({ id: queueId, content });

    this.dispatchEvent(new CustomEvent('hero:message-queued', {
      detail: { content, queueId },
      bubbles: true,
      composed: true,
    }));
  }

  /**
   * Send a message.
   * @param {string} content
   */
  async _sendMessage(content) {
    this.loading = true;

    try {
      this.dispatchEvent(new CustomEvent('hero:send-message', {
        detail: {
          content,
          files:     this.#pendingFiles.length > 0 ? [...this.#pendingFiles] : null,
          streaming: this.#streamingMode,
          sessionId: this.currentSession.id,
        },
        bubbles: true,
        composed: true,
      }));

      // Clear files after dispatching
      this.#pendingFiles = [];
      this._renderFilePreview();
    } finally {
      // Note: loading will be set to false by parent after response
    }
  }

  /**
   * Add files to pending list.
   * @param {File[]} files
   */
  _addFiles(files) {
    for (let file of files) {
      // Max 5 files
      if (this.#pendingFiles.length >= 5) break;

      // Max 10 MB each
      if (file.size > 10 * 1024 * 1024) {
        console.warn(`File too large: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
        continue;
      }

      this.#pendingFiles.push(file);
    }

    this._renderFilePreview();
  }

  /**
   * Remove a file from pending list.
   * @param {number} index
   */
  _removeFile(index) {
    this.#pendingFiles.splice(index, 1);
    this._renderFilePreview();
  }

  /**
   * Render file preview chips.
   */
  _renderFilePreview() {
    let bar = this.shadowRoot?.querySelector('.file-preview-bar');
    if (!bar) return;

    if (this.#pendingFiles.length === 0) {
      bar.classList.remove('has-files');
      bar.innerHTML = '';
      return;
    }

    bar.classList.add('has-files');
    bar.innerHTML = '';

    this.#pendingFiles.forEach((file, index) => {
      let chip = document.createElement('span');
      chip.className = 'file-chip';

      let isImage = file.type.startsWith('image/');

      if (isImage) {
        let img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.onload = () => URL.revokeObjectURL(img.src);
        chip.appendChild(img);
      }

      let name = document.createElement('span');
      name.textContent = file.name.length > 20 ? file.name.slice(0, 17) + '...' : file.name;
      chip.appendChild(name);

      let remove = document.createElement('span');
      remove.className = 'remove';
      remove.textContent = '\u00d7';
      remove.addEventListener('click', () => this._removeFile(index));
      chip.appendChild(remove);

      bar.appendChild(chip);
    });
  }

  /**
   * Update send button state.
   */
  _updateButtonState() {
    let button = this.shadowRoot?.querySelector('.send-button');
    if (button) {
      button.disabled = this.#isLoading || !this.currentSession;
    }
  }

  /**
   * Update disabled state of textarea based on session.
   */
  _updateDisabledState() {
    let textarea = this.textarea;
    if (textarea) {
      textarea.disabled = !this.currentSession;
      textarea.placeholder = this.placeholder;
    }
  }
}

// Register the component
HeroInput.register();
