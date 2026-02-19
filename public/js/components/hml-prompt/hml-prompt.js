'use strict';

/**
 * HML Prompt Web Component
 *
 * A custom element for inline user prompts within chat messages.
 * Uses Shadow DOM to encapsulate styles and functionality.
 *
 * Supported types:
 *   - text (default): Free-form text input
 *   - number: Numeric input with optional min/max/step
 *   - color: Color picker
 *   - checkbox: Single yes/no checkbox
 *   - checkboxes: Multi-select checkbox group (requires options)
 *   - radio: Radio button group (requires options)
 *   - select: Dropdown select (requires options)
 *   - range: Slider with min/max/step
 *
 * Options format (for select/radio/checkboxes):
 *   Preferred: JSON array in <data> child element
 *   <hml-prompt type="select">
 *     Question text
 *     <data>[{"value":"a","label":"Option A"},{"value":"b","label":"Option B","selected":true}]</data>
 *   </hml-prompt>
 */

import { MythixUIComponent } from '@cdn/mythix-ui-core@1';

// ============================================================================
// Event Cascade Prevention (Smell 2.3 fix)
// ============================================================================
// Using WeakSet to track consumed events - cleaner than element property flags.
// Events are automatically garbage collected when no longer referenced.

const consumedEvents = new WeakSet();

function consumeEvent(event) {
  if (consumedEvents.has(event)) {
    return false; // Already consumed
  }
  consumedEvents.add(event);
  return true; // First consumer
}

// ============================================================================
// Component Styles
// ============================================================================

const PROMPT_STYLES = `
  <style>
    :host {
      display: inline;
      vertical-align: baseline;
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
    }

    .container {
      display: inline-block;
      position: relative;
      vertical-align: baseline;
    }

    :host(:not([answered])) .container {
      background: rgba(59, 130, 246, 0.1);
      border-bottom: 1px dashed #3b82f6;
      border-radius: 6px;
      padding: 2px 6px;
    }

    .container.block {
      display: block;
      padding: 8px 12px;
      margin: 4px 0;
    }

    .question-label {
      display: block;
      margin-bottom: 6px;
      color: #3b82f6;
      font-weight: 500;
    }

    .sizer {
      visibility: hidden;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
      font-style: italic;
    }

    .input-text {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border: none;
      background: transparent;
      color: #3b82f6;
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
      font-style: italic;
      padding: 0;
      margin: 0;
      resize: none;
      overflow: hidden;
    }

    .input-text:focus { outline: none; }
    .input-text::placeholder { color: #3b82f6; font-style: italic; }

    .input-number {
      border: 1px solid #3b82f6;
      border-radius: 4px;
      background: transparent;
      color: #3b82f6;
      font-family: inherit;
      font-size: inherit;
      padding: 2px 6px;
      width: 80px;
      margin-left: 4px;
    }

    .input-number:focus { outline: none; border-color: #2563eb; }

    .input-generic {
      border: 1px solid #3b82f6;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      font-family: inherit;
      font-size: inherit;
      padding: 2px 6px;
      margin-left: 4px;
      min-width: 120px;
    }

    .input-generic:focus { outline: none; border-color: #2563eb; }

    .input-color {
      border: 1px solid #3b82f6;
      border-radius: 4px;
      background: transparent;
      width: 40px;
      height: 24px;
      padding: 0;
      margin-left: 4px;
      cursor: pointer;
      vertical-align: middle;
    }

    .input-color::-webkit-color-swatch-wrapper { padding: 2px; }
    .input-color::-webkit-color-swatch { border-radius: 2px; border: none; }

    .input-checkbox {
      width: 18px;
      height: 18px;
      margin-left: 4px;
      accent-color: #3b82f6;
      cursor: pointer;
      vertical-align: middle;
    }

    .radio-group, .checkbox-group {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
    }

    .radio-option, .checkbox-option {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
    }

    .radio-option input, .checkbox-option input {
      accent-color: #3b82f6;
      cursor: pointer;
    }

    .radio-option label, .checkbox-option label {
      cursor: pointer;
      color: var(--text-primary, #e2e8f0);
    }

    .input-select {
      border: 1px solid #3b82f6;
      border-radius: 4px;
      background: #fff;
      color: #1e3a5f;
      font-family: inherit;
      font-size: inherit;
      padding: 4px 8px;
      margin-left: 4px;
      cursor: pointer;
    }

    .input-select:focus { outline: none; border-color: #2563eb; }
    .input-select option { background: #fff; color: #1e3a5f; padding: 4px 8px; }

    .range-container {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-left: 4px;
    }

    .input-range { width: 120px; accent-color: #3b82f6; cursor: pointer; }
    .range-value { color: #3b82f6; font-weight: 500; min-width: 30px; text-align: center; }

    .submit-button {
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 4px 12px;
      margin-left: 8px;
      cursor: pointer;
      font-size: 0.9em;
    }

    .submit-button:hover { background: #2563eb; }

    /* Green "answered" style - triggered by either attribute */
    :host([answered]) .container,
    :host([value]) .container {
      background: rgba(34, 197, 94, 0.1);
      border-bottom: 1px solid #22c55e;
      border-radius: 6px;
      padding: 2px 6px;
    }

    .answer { color: #22c55e; }

    .color-swatch {
      display: inline-block;
      width: 16px;
      height: 16px;
      border-radius: 3px;
      vertical-align: middle;
      margin-right: 4px;
      border: 1px solid rgba(0,0,0,0.2);
    }
  </style>
`;

// ============================================================================
// HmlPrompt Component
// ============================================================================

class HmlPrompt extends MythixUIComponent {
  static tagName = 'hml-prompt';

  // Observed attributes - includes 'value' for server-provided answers
  static observedAttributes = ['answered', 'type', 'value'];

  constructor() {
    super();
    // Only attach shadow root if one doesn't already exist
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
    }
    // Time-based render loop detection (Smell 2.2 fix)
    this._renderTimes = [];
    this._renderWindowMs = 1000; // 1 second window
    this._maxRendersInWindow = 50; // Allow 50 renders per second
    this._isRendering = false;
  }

  connectedCallback() {
    super.connectedCallback?.();
    this._renderTimes = [];
    // Persist a stable ID so promptId returns the same value consistently
    if (!this.getAttribute('id')) {
      this.setAttribute('id', 'prompt-' + Math.random().toString(36).substring(2, 10));
    }
    if (this.getAttribute('answered') === 'false') {
      this.removeAttribute('answered');
    }
    // Check for value attribute (server-provided answer)
    const value = this.getAttribute('value');
    if (value && !this.isAnswered) {
      this._setAnswer(value);
    }
    this.render();
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    this._renderTimes = [];
    this._isRendering = false;
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    if (!this.isConnected) return;
    if (this._isSubmitting) return;

    // Handle value attribute for server-provided answers
    if (name === 'value' && newValue && !this.isAnswered) {
      this._setAnswer(newValue);
      return;
    }

    this.render();
  }

  /**
   * Set the answer without dispatching a submit event.
   * Used when the answer comes from the server (via value attribute or UPDATE frame).
   * @param {string} answer
   */
  _setAnswer(answer) {
    if (this.isAnswered) return;

    const question = this.question;
    this.innerHTML = `${question}<response>${this._escapeHtml(answer)}</response>`;
    this.setAttribute('answered', '');
    this._renderTimes = [];
    this._isRendering = false;
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  get promptId() {
    return this.getAttribute('id') || this._generateId();
  }

  get promptType() {
    return this.getAttribute('type') || 'text';
  }

  get isAnswered() {
    // Answered if either 'answered' attribute is set OR 'value' attribute has content
    const answered = this.getAttribute('answered');
    const value = this.getAttribute('value');
    return (answered !== null && answered !== 'false') || (value !== null && value !== '');
  }

  get question() {
    const clone = this.cloneNode(true);
    clone.querySelectorAll('response, option, opt, data').forEach((el) => el.remove());
    return clone.textContent.trim();
  }

  get response() {
    // Check <response> element first, then fall back to value attribute
    const responseEl = this.querySelector('response');
    if (responseEl) {
      return responseEl.textContent.trim();
    }
    // Fall back to value attribute (server-provided answer)
    const value = this.getAttribute('value');
    return (value) ? value : '';
  }

  get options() {
    let dataEl = this.querySelector('data');
    if (dataEl) {
      try {
        let rawText = dataEl.textContent.trim();
        let decoded = this._decodeHtmlEntities(rawText);
        let parsed = JSON.parse(decoded);
        return this._normalizeOptions(parsed);
      } catch (e) {
        console.warn('[hml-prompt] Failed to parse <data> JSON:', e);
      }
    }

    let optionsAttr = this.getAttribute('options');
    if (optionsAttr) {
      try {
        let parsed = JSON.parse(optionsAttr);
        return this._normalizeOptions(parsed);
      } catch (e) {
        console.warn('[hml-prompt] Failed to parse options JSON:', e);
      }
    }

    let optionEls = this.querySelectorAll('option, opt');
    return Array.from(optionEls).map((opt) => ({
      value:    opt.getAttribute('value') || opt.textContent.trim(),
      label:    opt.textContent.trim(),
      selected: opt.hasAttribute('selected'),
    }));
  }

  /**
   * Normalize options array to handle multiple formats:
   * - Array of strings: ["Option A", "Option B"]
   * - Array of objects: [{value: "a", label: "Option A"}]
   * - Mixed: ["Option A", {value: "b", label: "Option B"}]
   */
  _normalizeOptions(parsed) {
    if (!Array.isArray(parsed)) return [];
    return parsed.map((opt) => {
      // Handle string format: "Option A" -> {value: "Option A", label: "Option A"}
      if (typeof opt === 'string') {
        return { value: opt, label: opt, selected: false };
      }
      // Handle object format: {value, label, selected}
      return {
        value:    opt.value || opt.label || '',
        label:    opt.label || opt.value || '',
        selected: !!opt.selected,
      };
    });
  }

  get min() { return this.getAttribute('min'); }
  get max() { return this.getAttribute('max'); }
  get step() { return this.getAttribute('step') || '1'; }
  get defaultValue() { return this.getAttribute('default'); }

  /**
   * Get the value attribute (server-provided answer).
   * @returns {string|null}
   */
  get value() { return this.getAttribute('value'); }

  /**
   * Set value programmatically (triggers answer).
   * @param {string} val
   */
  set value(val) {
    if (val && !this.isAnswered) {
      this._setAnswer(val);
    }
  }

  _generateId() {
    return 'prompt-' + Math.random().toString(36).substring(2, 10);
  }

  // ---------------------------------------------------------------------------
  // Render Methods
  // ---------------------------------------------------------------------------

  render() {
    if (this._isRendering) return;

    // Time-based render loop detection
    const now = Date.now();
    this._renderTimes = this._renderTimes.filter((t) => now - t < this._renderWindowMs);
    this._renderTimes.push(now);

    if (this._renderTimes.length > this._maxRendersInWindow) {
      console.error('[hml-prompt] Render loop detected: ' + this._renderTimes.length + ' renders in ' + this._renderWindowMs + 'ms');
      return;
    }

    this._isRendering = true;
    try {
      if (this.isAnswered) {
        this._renderAnswered();
      } else {
        switch (this.promptType) {
          case 'number': this._renderNumber(); break;
          case 'color': this._renderColor(); break;
          case 'checkbox': this._renderCheckbox(); break;
          case 'checkboxes': this._renderCheckboxes(); break;
          case 'radio': this._renderRadio(); break;
          case 'select': this._renderSelect(); break;
          case 'range': this._renderRange(); break;
          case 'email':
          case 'password':
          case 'url':
          case 'tel':
          case 'date':
          case 'time':
          case 'datetime-local':
            this._renderInput(this.promptType); break;
          case 'text':
          default: this._renderText(); break;
        }
      }
    } finally {
      this._isRendering = false;
    }
  }

  _renderAnswered() {
    let response = this.response;
    let displayValue = response;

    if (this.promptType === 'color') {
      displayValue = `<span class="color-swatch" style="background:${this._escapeHtml(response)}"></span>${this._escapeHtml(response)}`;
    } else if (this.promptType === 'checkbox') {
      displayValue = (response === 'true' || response === 'yes') ? 'Yes' : 'No';
    } else {
      displayValue = this._escapeHtml(response);
    }

    this.shadowRoot.innerHTML = `
      ${PROMPT_STYLES}
      <span class="container" title="${this._escapeHtml(this.question)}">
        <span class="answer">${displayValue}</span>
      </span>
    `;
  }

  _renderText() {
    let question = this._escapeHtml(this.question);
    this.shadowRoot.innerHTML = `
      ${PROMPT_STYLES}
      <span class="container">
        <span class="sizer">${question}</span>
        <textarea class="input-text" rows="1" placeholder="${question}" title="Press Enter to submit"></textarea>
      </span>
    `;

    let input = this.shadowRoot.querySelector('.input-text');
    let sizer = this.shadowRoot.querySelector('.sizer');

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        if (!consumeEvent(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        let answer = input.value.trim();
        if (answer) this._submitAnswer(answer);
      }
    });
    input.addEventListener('input', () => {
      sizer.textContent = (input.value || input.placeholder || '') + '\u200B';
    });
  }

  _renderNumber() {
    let question = this._escapeHtml(this.question);
    let minAttr = (this.min !== null) ? `min="${this.min}"` : '';
    let maxAttr = (this.max !== null) ? `max="${this.max}"` : '';
    let stepAttr = `step="${this.step}"`;
    let defVal = this.defaultValue || '';

    this.shadowRoot.innerHTML = `
      ${PROMPT_STYLES}
      <span class="container">
        <span class="question-inline">${question}</span>
        <input type="number" class="input-number" ${minAttr} ${maxAttr} ${stepAttr} value="${defVal}" title="Enter a number and press Enter">
      </span>
    `;

    let input = this.shadowRoot.querySelector('.input-number');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (!consumeEvent(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        let answer = input.value.trim();
        if (answer) this._submitAnswer(answer);
      }
    });
  }

  /**
   * Render generic HTML input types (email, password, url, tel, date, time, datetime-local).
   * @param {string} inputType - The HTML input type
   */
  _renderInput(inputType) {
    let question = this._escapeHtml(this.question);
    let defVal = this.defaultValue || '';
    let placeholder = this._getPlaceholder(inputType);

    this.shadowRoot.innerHTML = `
      ${PROMPT_STYLES}
      <span class="container">
        <span class="question-inline">${question}</span>
        <input type="${inputType}" class="input-generic" value="${defVal}" placeholder="${placeholder}" title="Press Enter to submit">
        <button class="submit-button">OK</button>
      </span>
    `;

    let input = this.shadowRoot.querySelector('.input-generic');
    let button = this.shadowRoot.querySelector('.submit-button');

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (!consumeEvent(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        let answer = input.value.trim();
        if (answer) this._submitAnswer(answer);
      }
    });

    button.addEventListener('click', (e) => {
      if (!consumeEvent(e)) return;
      e.preventDefault();
      let answer = input.value.trim();
      if (answer) this._submitAnswer(answer);
    });
  }

  /**
   * Get placeholder text for input type.
   * @param {string} inputType
   * @returns {string}
   */
  _getPlaceholder(inputType) {
    const placeholders = {
      email: 'email@example.com',
      password: '',
      url: 'https://...',
      tel: '+1 (555) 123-4567',
      date: '',
      time: '',
      'datetime-local': '',
    };
    return placeholders[inputType] || '';
  }

  _renderColor() {
    let question = this._escapeHtml(this.question);
    let defVal = this.defaultValue || '#3b82f6';

    this.shadowRoot.innerHTML = `
      ${PROMPT_STYLES}
      <span class="container">
        <span class="question-inline">${question}</span>
        <input type="color" class="input-color" value="${defVal}" title="Pick a color">
        <button class="submit-button">OK</button>
      </span>
    `;

    let input = this.shadowRoot.querySelector('.input-color');
    let submit = this.shadowRoot.querySelector('.submit-button');

    submit.addEventListener('click', (e) => {
      if (!consumeEvent(e)) return;
      e.stopImmediatePropagation();
      this._submitAnswer(input.value);
    });
  }

  _renderCheckbox() {
    let question = this._escapeHtml(this.question);
    let checked = (this.defaultValue === 'true' || this.defaultValue === 'yes') ? 'checked' : '';

    this.shadowRoot.innerHTML = `
      ${PROMPT_STYLES}
      <span class="container">
        <label style="cursor: pointer;">
          <input type="checkbox" class="input-checkbox" ${checked}>
          <span class="question-inline">${question}</span>
        </label>
        <button class="submit-button">OK</button>
      </span>
    `;

    let input = this.shadowRoot.querySelector('.input-checkbox');
    let submit = this.shadowRoot.querySelector('.submit-button');

    submit.addEventListener('click', (e) => {
      if (!consumeEvent(e)) return;
      e.stopImmediatePropagation();
      this._submitAnswer(input.checked ? 'yes' : 'no');
    });
  }

  _renderCheckboxes() {
    let question = this._escapeHtml(this.question);
    let options = this.options;
    let name = this.promptId;

    let optionsHtml = options.map((opt, i) => {
      let checked = opt.selected ? 'checked' : '';
      return `
        <div class="checkbox-option">
          <input type="checkbox" name="${name}" id="${name}-${i}" value="${this._escapeHtml(opt.value)}" ${checked}>
          <label for="${name}-${i}">${this._escapeHtml(opt.label)}</label>
        </div>
      `;
    }).join('');

    this.shadowRoot.innerHTML = `
      ${PROMPT_STYLES}
      <div class="container block">
        <span class="question-label">${question}</span>
        <div class="checkbox-group">${optionsHtml}</div>
        <button class="submit-button" style="margin-top: 8px;">OK</button>
      </div>
    `;

    let submit = this.shadowRoot.querySelector('.submit-button');
    submit.addEventListener('click', (e) => {
      if (!consumeEvent(e)) return;
      e.stopImmediatePropagation();
      let checked = this.shadowRoot.querySelectorAll(`input[name="${name}"]:checked`);
      let values = Array.from(checked).map((cb) => cb.value);
      if (values.length > 0) {
        this._submitAnswer(values.join(', '));
      }
    });
  }

  _renderRadio() {
    let question = this._escapeHtml(this.question);
    let options = this.options;
    let name = this.promptId;

    let optionsHtml = options.map((opt, i) => {
      let checked = opt.selected ? 'checked' : '';
      return `
        <div class="radio-option">
          <input type="radio" name="${name}" id="${name}-${i}" value="${this._escapeHtml(opt.value)}" ${checked}>
          <label for="${name}-${i}">${this._escapeHtml(opt.label)}</label>
        </div>
      `;
    }).join('');

    this.shadowRoot.innerHTML = `
      ${PROMPT_STYLES}
      <div class="container block">
        <span class="question-label">${question}</span>
        <div class="radio-group">${optionsHtml}</div>
        <button class="submit-button" style="margin-top: 8px;">OK</button>
      </div>
    `;

    let submit = this.shadowRoot.querySelector('.submit-button');
    submit.addEventListener('click', (e) => {
      if (!consumeEvent(e)) return;
      e.stopImmediatePropagation();
      let selected = this.shadowRoot.querySelector(`input[name="${name}"]:checked`);
      if (selected) {
        this._submitAnswer(selected.value);
      }
    });
  }

  _renderSelect() {
    let question = this._escapeHtml(this.question);
    let options = this.options;

    let optionsHtml = options.map((opt) => {
      let selected = opt.selected ? 'selected' : '';
      return `<option value="${this._escapeHtml(opt.value)}" ${selected}>${this._escapeHtml(opt.label)}</option>`;
    }).join('');

    this.shadowRoot.innerHTML = `
      ${PROMPT_STYLES}
      <span class="container">
        <span class="question-inline">${question}</span>
        <select class="input-select">
          <option value="">-- Select --</option>
          ${optionsHtml}
        </select>
        <button class="submit-button">OK</button>
      </span>
    `;

    let select = this.shadowRoot.querySelector('.input-select');
    let submit = this.shadowRoot.querySelector('.submit-button');

    submit.addEventListener('click', (e) => {
      if (!consumeEvent(e)) return;
      e.stopImmediatePropagation();
      if (select.value) {
        this._submitAnswer(select.value);
      }
    });
  }

  _renderRange() {
    let question = this._escapeHtml(this.question);
    let minVal = this.min || '0';
    let maxVal = this.max || '100';
    let stepVal = this.step || '1';
    let defVal = this.defaultValue || Math.round((parseFloat(minVal) + parseFloat(maxVal)) / 2);

    this.shadowRoot.innerHTML = `
      ${PROMPT_STYLES}
      <span class="container">
        <span class="question-inline">${question}</span>
        <span class="range-container">
          <span class="range-value">${defVal}</span>
          <input type="range" class="input-range" min="${minVal}" max="${maxVal}" step="${stepVal}" value="${defVal}">
        </span>
        <button class="submit-button">OK</button>
      </span>
    `;

    let input = this.shadowRoot.querySelector('.input-range');
    let valueLabel = this.shadowRoot.querySelector('.range-value');
    let submit = this.shadowRoot.querySelector('.submit-button');

    input.addEventListener('input', () => {
      valueLabel.textContent = input.value;
    });

    submit.addEventListener('click', (e) => {
      if (!consumeEvent(e)) return;
      e.stopImmediatePropagation();
      this._submitAnswer(input.value);
    });
  }

  // ---------------------------------------------------------------------------
  // Submission
  // ---------------------------------------------------------------------------

  _submitAnswer(answer) {
    if (!this.isConnected) return;
    if (this._isSubmitting || this.isAnswered) return;

    this._isSubmitting = true;

    let question = this.question;
    let messageEl = this.closest('[data-message-id]');
    let messageId = (messageEl) ? messageEl.dataset.messageId : null;

    if (this.isConnected) {
      this.innerHTML = `${question}<response>${this._escapeHtml(answer)}</response>`;
      this.setAttribute('answered', '');
      this._renderTimes = [];
      this._isRendering = false;
      this.render();
    }

    queueMicrotask(() => {
      this.dispatchEvent(new CustomEvent('prompt-submit', {
        bubbles: true,
        composed: true,
        detail: {
          messageId: messageId,
          promptId: this.promptId,
          question: question,
          answer: answer,
          type: this.promptType,
        },
      }));
    });
  }

  _escapeHtml(text) {
    if (!text) return '';
    let div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  _decodeHtmlEntities(text) {
    if (!text) return '';
    // Decode HTML entities
    let div = document.createElement('div');
    div.innerHTML = text;
    let decoded = div.textContent;
    // Convert smart quotes to straight quotes (markdown typographer converts these)
    decoded = decoded
      .replace(/[\u201C\u201D]/g, '"')  // " " -> "
      .replace(/[\u2018\u2019]/g, "'"); // ' ' -> '
    return decoded;
  }
}

// Register the component
HmlPrompt.register();

export { HmlPrompt };
