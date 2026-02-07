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
 *
 * Usage:
 *   <hml-prompt id="name">What is your name?</hml-prompt>
 *   <hml-prompt id="age" type="number" min="0" max="120">How old are you?</hml-prompt>
 *   <hml-prompt id="color" type="color">Pick a color</hml-prompt>
 *   <hml-prompt id="agree" type="checkbox">Do you agree?</hml-prompt>
 *   <hml-prompt id="size" type="radio">
 *     What size?
 *     <data>[{"value":"s","label":"Small"},{"value":"m","label":"Medium","selected":true},{"value":"l","label":"Large"}]</data>
 *   </hml-prompt>
 *   <hml-prompt id="country" type="select">
 *     Select country
 *     <data>[{"value":"us","label":"United States"},{"value":"uk","label":"United Kingdom"}]</data>
 *   </hml-prompt>
 *   <hml-prompt id="rating" type="range" min="1" max="10" step="1">Rate 1-10</hml-prompt>
 *   <hml-prompt id="toppings" type="checkboxes">
 *     Select toppings
 *     <data>[{"value":"cheese","label":"Cheese"},{"value":"pepperoni","label":"Pepperoni"},{"value":"mushrooms","label":"Mushrooms","selected":true}]</data>
 *   </hml-prompt>
 *
 * Answered state:
 *   <hml-prompt id="name" answered>What is your name?<response>Alice</response></hml-prompt>
 */
class HmlPrompt extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._renderCount = 0;
    this._isRendering = false;
  }

  static get observedAttributes() {
    return ['answered', 'type'];
  }

  connectedCallback() {
    // Reset render count on fresh connection
    this._renderCount = 0;
    // Normalize answered="false" to no attribute (for CSS selectors)
    if (this.getAttribute('answered') === 'false') {
      this.removeAttribute('answered');
    }
    this.render();
  }

  disconnectedCallback() {
    // Reset state when disconnected
    this._renderCount = 0;
    this._isRendering = false;
  }

  attributeChangedCallback(name, oldValue, newValue) {
    // Only render if attribute actually changed AND element is still in DOM
    // (prevents issues when element is detached during event handling)
    // Skip if we're in the middle of submitting (submitAnswer will call render directly)
    if (oldValue !== newValue && this.isConnected && !this._isSubmitting) {
      this.render();
    }
  }

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  get promptId() {
    return this.getAttribute('id') || this.generateId();
  }

  get promptType() {
    return this.getAttribute('type') || 'text';
  }

  get isAnswered() {
    // Check attribute exists AND is not explicitly "false"
    // (Agent may output answered="false" for unanswered prompts)
    let val = this.getAttribute('answered');
    return val !== null && val !== 'false';
  }

  get question() {
    // Get text content excluding <response>, <option>, <opt>, and <data> elements
    let clone = this.cloneNode(true);
    clone.querySelectorAll('response, option, opt, data').forEach((el) => el.remove());
    return clone.textContent.trim();
  }

  get response() {
    let responseEl = this.querySelector('response');
    return responseEl ? responseEl.textContent.trim() : '';
  }

  get options() {
    // Method 1: Check for <data> child element with JSON array (preferred)
    // Format: <data>[{"value":"a","label":"Label A"},...]</data>
    let dataEl = this.querySelector('data');
    if (dataEl) {
      try {
        let parsed = JSON.parse(dataEl.textContent.trim());
        return parsed.map((opt) => ({
          value:    opt.value || opt.label || '',
          label:    opt.label || opt.value || '',
          selected: !!opt.selected,
        }));
      } catch (e) {
        console.warn('[hml-prompt] Failed to parse <data> JSON:', e);
      }
    }

    // Method 2: Check for options attribute with JSON array
    // Format: options='[{"value":"a","label":"Label A"},...]'
    let optionsAttr = this.getAttribute('options');
    if (optionsAttr) {
      try {
        let parsed = JSON.parse(optionsAttr);
        return parsed.map((opt) => ({
          value:    opt.value || opt.label || '',
          label:    opt.label || opt.value || '',
          selected: !!opt.selected,
        }));
      } catch (e) {
        console.warn('[hml-prompt] Failed to parse options JSON:', e);
      }
    }

    // Method 3 (fallback): Get <option> or <opt> children
    // Note: <option> is converted to <opt> by markup.js before parsing
    // because browsers strip <option> tags when not inside <select>
    let optionEls = this.querySelectorAll('option, opt');
    return Array.from(optionEls).map((opt) => ({
      value:    opt.getAttribute('value') || opt.textContent.trim(),
      label:    opt.textContent.trim(),
      selected: opt.hasAttribute('selected'),
    }));
  }

  // Numeric attributes
  get min() { return this.getAttribute('min'); }
  get max() { return this.getAttribute('max'); }
  get step() { return this.getAttribute('step') || '1'; }
  get defaultValue() { return this.getAttribute('default'); }

  generateId() {
    return 'prompt-' + Math.random().toString(36).substring(2, 10);
  }

  // -------------------------------------------------------------------------
  // Styles
  // -------------------------------------------------------------------------

  getStyles() {
    return `
      <style>
        :host {
          display: inline;
          vertical-align: baseline;
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
        }

        /* Container: inline-block with relative positioning */
        .container {
          display: inline-block;
          position: relative;
          vertical-align: baseline;
        }

        /* Unanswered state - subtle inline input */
        :host(:not([answered])) .container {
          background: rgba(59, 130, 246, 0.1);
          border-bottom: 1px dashed #3b82f6;
          border-radius: 6px;
          padding: 2px 6px;
        }

        /* Block container for multi-option types */
        .container.block {
          display: block;
          padding: 8px 12px;
          margin: 4px 0;
        }

        /* Question label for block types */
        .question-label {
          display: block;
          margin-bottom: 6px;
          color: #3b82f6;
          font-weight: 500;
        }

        /* Sizer: invisible text that determines size and allows wrapping */
        .sizer {
          visibility: hidden;
          white-space: pre-wrap;
          word-break: break-word;
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
          font-style: italic;
        }

        /* Text input (textarea) overlays the sizer exactly */
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

        .input-text:focus {
          outline: none;
        }

        .input-text::placeholder {
          color: #3b82f6;
          font-style: italic;
        }

        /* Number input */
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

        .input-number:focus {
          outline: none;
          border-color: #2563eb;
        }

        /* Color input */
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

        .input-color::-webkit-color-swatch-wrapper {
          padding: 2px;
        }

        .input-color::-webkit-color-swatch {
          border-radius: 2px;
          border: none;
        }

        /* Checkbox */
        .input-checkbox {
          width: 18px;
          height: 18px;
          margin-left: 4px;
          accent-color: #3b82f6;
          cursor: pointer;
          vertical-align: middle;
        }

        /* Radio group */
        .radio-group {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 16px;
        }

        .radio-option {
          display: flex;
          align-items: center;
          gap: 4px;
          cursor: pointer;
        }

        .radio-option input {
          accent-color: #3b82f6;
          cursor: pointer;
        }

        .radio-option label {
          cursor: pointer;
          color: inherit;
        }

        /* Checkbox group (multi-select) */
        .checkbox-group {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 16px;
        }

        .checkbox-option {
          display: flex;
          align-items: center;
          gap: 4px;
          cursor: pointer;
        }

        .checkbox-option input {
          accent-color: #3b82f6;
          cursor: pointer;
        }

        .checkbox-option label {
          cursor: pointer;
          color: inherit;
        }

        /* Select dropdown */
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

        .input-select:focus {
          outline: none;
          border-color: #2563eb;
        }

        .input-select option {
          background: #fff;
          color: #1e3a5f;
          padding: 4px 8px;
        }

        /* Range slider */
        .range-container {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-left: 4px;
        }

        .input-range {
          width: 120px;
          accent-color: #3b82f6;
          cursor: pointer;
        }

        .range-value {
          color: #3b82f6;
          font-weight: 500;
          min-width: 30px;
          text-align: center;
        }

        /* Submit button for types that need explicit submit */
        .submit-btn {
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 4px 12px;
          margin-left: 8px;
          cursor: pointer;
          font-size: 0.9em;
        }

        .submit-btn:hover {
          background: #2563eb;
        }

        /* Answered state - subtle inline response */
        :host([answered]) .container {
          background: rgba(34, 197, 94, 0.1);
          border-bottom: 1px solid #22c55e;
          border-radius: 6px;
          padding: 2px 6px;
        }

        .answer {
          color: #22c55e;
        }

        /* Color swatch for answered color */
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
  }

  // -------------------------------------------------------------------------
  // Render Methods
  // -------------------------------------------------------------------------

  render() {
    // Prevent re-entrant rendering
    if (this._isRendering) {
      return;
    }

    // Detect infinite render loops (more than 10 renders per element instance)
    this._renderCount++;
    if (this._renderCount > 10) {
      console.error('[hml-prompt] Render loop detected! Stopping after', this._renderCount, 'renders');
      return;
    }

    this._isRendering = true;
    try {
      if (this.isAnswered) {
        this.renderAnswered();
      } else {
        switch (this.promptType) {
          case 'number':
            this.renderNumber();
            break;
          case 'color':
            this.renderColor();
            break;
          case 'checkbox':
            this.renderCheckbox();
            break;
          case 'checkboxes':
            this.renderCheckboxes();
            break;
          case 'radio':
            this.renderRadio();
            break;
          case 'select':
            this.renderSelect();
            break;
          case 'range':
            this.renderRange();
            break;
          case 'text':
          default:
            this.renderText();
            break;
        }
      }
    } finally {
      this._isRendering = false;
    }
  }

  renderAnswered() {
    let response     = this.response;
    let displayValue = response;

    // Format display based on type
    if (this.promptType === 'color') {
      displayValue = `<span class="color-swatch" style="background:${this.escapeHtml(response)}"></span>${this.escapeHtml(response)}`;
    } else if (this.promptType === 'checkbox') {
      displayValue = (response === 'true' || response === 'yes') ? 'Yes' : 'No';
    } else {
      displayValue = this.escapeHtml(response);
    }

    this.shadowRoot.innerHTML = `
      ${this.getStyles()}
      <span class="container" title="${this.escapeHtml(this.question)}">
        <span class="answer">${displayValue}</span>
      </span>
    `;
  }

  renderText() {
    let question = this.escapeHtml(this.question);
    this.shadowRoot.innerHTML = `
      ${this.getStyles()}
      <span class="container">
        <span class="sizer">${question}</span>
        <textarea class="input-text"
                  rows="1"
                  placeholder="${question}"
                  title="Press Enter to submit"></textarea>
      </span>
    `;

    let input = this.shadowRoot.querySelector('.input-text');
    let sizer = this.shadowRoot.querySelector('.sizer');

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        let answer = input.value.trim();
        if (answer) this.submitAnswer(answer);
      }
    });
    input.addEventListener('input', () => {
      sizer.textContent = (input.value || input.placeholder || '') + '\u200B';
    });
  }

  renderNumber() {
    let question = this.escapeHtml(this.question);
    let minAttr  = (this.min !== null) ? `min="${this.min}"` : '';
    let maxAttr  = (this.max !== null) ? `max="${this.max}"` : '';
    let stepAttr = `step="${this.step}"`;
    let defVal   = this.defaultValue || '';

    this.shadowRoot.innerHTML = `
      ${this.getStyles()}
      <span class="container">
        <span class="question-inline">${question}</span>
        <input type="number" class="input-number" ${minAttr} ${maxAttr} ${stepAttr} value="${defVal}"
               title="Enter a number and press Enter">
      </span>
    `;

    let input = this.shadowRoot.querySelector('.input-number');
    // Guard against repeated event dispatch (browser quirk with number inputs)
    // Use a property on the element to track if we're currently handling an Enter press
    input._handlingEnter = false;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        // Skip if already handling or if event was already processed
        if (input._handlingEnter || e._hmlHandled) return;
        input._handlingEnter = true;
        e._hmlHandled = true;  // Mark event as processed
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        let answer = input.value.trim();
        if (answer) this.submitAnswer(answer);
        // Reset handling flag after processing completes
        setTimeout(() => { input._handlingEnter = false; }, 100);
      }
    });
  }

  renderColor() {
    let question = this.escapeHtml(this.question);
    let defVal   = this.defaultValue || '#3b82f6';

    this.shadowRoot.innerHTML = `
      ${this.getStyles()}
      <span class="container">
        <span class="question-inline">${question}</span>
        <input type="color" class="input-color" value="${defVal}" title="Pick a color">
        <button class="submit-btn">OK</button>
      </span>
    `;

    let input  = this.shadowRoot.querySelector('.input-color');
    let submit = this.shadowRoot.querySelector('.submit-btn');

    submit._handlingClick = false;
    submit.addEventListener('click', (e) => {
      if (submit._handlingClick || e._hmlHandled) return;
      submit._handlingClick = true;
      e._hmlHandled = true;
      e.stopImmediatePropagation();
      this.submitAnswer(input.value);
      setTimeout(() => { submit._handlingClick = false; }, 100);
    });
  }

  renderCheckbox() {
    let question = this.escapeHtml(this.question);
    let checked  = (this.defaultValue === 'true' || this.defaultValue === 'yes') ? 'checked' : '';

    this.shadowRoot.innerHTML = `
      ${this.getStyles()}
      <span class="container">
        <label style="cursor: pointer;">
          <input type="checkbox" class="input-checkbox" ${checked}>
          <span class="question-inline">${question}</span>
        </label>
        <button class="submit-btn">OK</button>
      </span>
    `;

    let input  = this.shadowRoot.querySelector('.input-checkbox');
    let submit = this.shadowRoot.querySelector('.submit-btn');

    submit._handlingClick = false;
    submit.addEventListener('click', (e) => {
      if (submit._handlingClick || e._hmlHandled) return;
      submit._handlingClick = true;
      e._hmlHandled = true;
      e.stopImmediatePropagation();
      this.submitAnswer(input.checked ? 'yes' : 'no');
      setTimeout(() => { submit._handlingClick = false; }, 100);
    });
  }

  renderCheckboxes() {
    let question = this.escapeHtml(this.question);
    let options  = this.options;
    let name     = this.promptId;

    let optionsHtml = options.map((opt, i) => {
      let checked = opt.selected ? 'checked' : '';
      return `
        <div class="checkbox-option">
          <input type="checkbox" name="${name}" id="${name}-${i}" value="${this.escapeHtml(opt.value)}" ${checked}>
          <label for="${name}-${i}">${this.escapeHtml(opt.label)}</label>
        </div>
      `;
    }).join('');

    this.shadowRoot.innerHTML = `
      ${this.getStyles()}
      <div class="container block">
        <span class="question-label">${question}</span>
        <div class="checkbox-group">
          ${optionsHtml}
        </div>
        <button class="submit-btn" style="margin-top: 8px;">OK</button>
      </div>
    `;

    let submit = this.shadowRoot.querySelector('.submit-btn');
    submit._handlingClick = false;
    submit.addEventListener('click', (e) => {
      if (submit._handlingClick || e._hmlHandled) return;
      submit._handlingClick = true;
      e._hmlHandled = true;
      e.stopImmediatePropagation();
      let checked = this.shadowRoot.querySelectorAll(`input[name="${name}"]:checked`);
      let values = Array.from(checked).map((cb) => cb.value);
      if (values.length > 0) {
        this.submitAnswer(values.join(', '));
      }
      setTimeout(() => { submit._handlingClick = false; }, 100);
    });
  }

  renderRadio() {
    let question = this.escapeHtml(this.question);
    let options  = this.options;
    let name     = this.promptId;

    let optionsHtml = options.map((opt, i) => {
      let checked = opt.selected ? 'checked' : '';
      return `
        <div class="radio-option">
          <input type="radio" name="${name}" id="${name}-${i}" value="${this.escapeHtml(opt.value)}" ${checked}>
          <label for="${name}-${i}">${this.escapeHtml(opt.label)}</label>
        </div>
      `;
    }).join('');

    this.shadowRoot.innerHTML = `
      ${this.getStyles()}
      <div class="container block">
        <span class="question-label">${question}</span>
        <div class="radio-group">
          ${optionsHtml}
        </div>
        <button class="submit-btn" style="margin-top: 8px;">OK</button>
      </div>
    `;

    let submit = this.shadowRoot.querySelector('.submit-btn');
    submit._handlingClick = false;
    submit.addEventListener('click', (e) => {
      if (submit._handlingClick || e._hmlHandled) return;
      submit._handlingClick = true;
      e._hmlHandled = true;
      e.stopImmediatePropagation();
      let selected = this.shadowRoot.querySelector(`input[name="${name}"]:checked`);
      if (selected) {
        this.submitAnswer(selected.value);
      }
      setTimeout(() => { submit._handlingClick = false; }, 100);
    });
  }

  renderSelect() {
    let question = this.escapeHtml(this.question);
    let options  = this.options;

    let optionsHtml = options.map((opt) => {
      let selected = opt.selected ? 'selected' : '';
      return `<option value="${this.escapeHtml(opt.value)}" ${selected}>${this.escapeHtml(opt.label)}</option>`;
    }).join('');

    this.shadowRoot.innerHTML = `
      ${this.getStyles()}
      <span class="container">
        <span class="question-inline">${question}</span>
        <select class="input-select">
          <option value="">-- Select --</option>
          ${optionsHtml}
        </select>
        <button class="submit-btn">OK</button>
      </span>
    `;

    let select = this.shadowRoot.querySelector('.input-select');
    let submit = this.shadowRoot.querySelector('.submit-btn');

    submit._handlingClick = false;
    submit.addEventListener('click', (e) => {
      if (submit._handlingClick || e._hmlHandled) return;
      submit._handlingClick = true;
      e._hmlHandled = true;
      e.stopImmediatePropagation();
      if (select.value) {
        this.submitAnswer(select.value);
      }
      setTimeout(() => { submit._handlingClick = false; }, 100);
    });
  }

  renderRange() {
    let question = this.escapeHtml(this.question);
    let minVal   = this.min || '0';
    let maxVal   = this.max || '100';
    let stepVal  = this.step || '1';
    let defVal   = this.defaultValue || Math.round((parseFloat(minVal) + parseFloat(maxVal)) / 2);

    this.shadowRoot.innerHTML = `
      ${this.getStyles()}
      <span class="container">
        <span class="question-inline">${question}</span>
        <span class="range-container">
          <span class="range-value">${defVal}</span>
          <input type="range" class="input-range" min="${minVal}" max="${maxVal}" step="${stepVal}" value="${defVal}">
        </span>
        <button class="submit-btn">OK</button>
      </span>
    `;

    let input      = this.shadowRoot.querySelector('.input-range');
    let valueLabel = this.shadowRoot.querySelector('.range-value');
    let submit     = this.shadowRoot.querySelector('.submit-btn');

    input.addEventListener('input', () => {
      valueLabel.textContent = input.value;
    });

    submit._handlingClick = false;
    submit.addEventListener('click', (e) => {
      if (submit._handlingClick || e._hmlHandled) return;
      submit._handlingClick = true;
      e._hmlHandled = true;
      e.stopImmediatePropagation();
      this.submitAnswer(input.value);
      setTimeout(() => { submit._handlingClick = false; }, 100);
    });
  }

  // -------------------------------------------------------------------------
  // Submission
  // -------------------------------------------------------------------------

  submitAnswer(answer) {
    // Prevent submission if not connected
    if (!this.isConnected) {
      return;
    }

    // Prevent double submission - check both flag AND answered state
    if (this._isSubmitting || this.isAnswered) {
      return;
    }

    // Lock submission PERMANENTLY until attribute is set
    // (don't reset - the answered attribute check will take over)
    this._isSubmitting = true;

    // Capture question before any DOM changes (in case event handler triggers rerender)
    let question = this.question;

    // Find the message ID from the parent message element
    let messageEl = this.closest('[data-message-id]');
    let messageId = (messageEl) ? parseInt(messageEl.dataset.messageId, 10) : null;

    // Set answered state FIRST, before dispatching event
    // This ensures any re-entrant calls are blocked
    if (this.isConnected) {
      this.innerHTML = `${question}<response>${this.escapeHtml(answer)}</response>`;
      this.setAttribute('answered', '');
      // Force immediate re-render to show answered state
      // (attributeChangedCallback won't fire during submission)
      this._renderCount = 0;  // Reset to allow render
      this._isRendering = false;  // Clear any stale flag
      this.render();
    }

    // Dispatch custom event AFTER updating state
    // Use queueMicrotask to ensure DOM is stable before event handlers run
    queueMicrotask(() => {
      this.dispatchEvent(new CustomEvent('prompt-submit', {
        bubbles:  true,
        composed: true,  // Crosses shadow DOM boundary
        detail:   {
          messageId: messageId,
          promptId:  this.promptId,
          question:  question,
          answer:    answer,
          type:      this.promptType,
        },
      }));
    });
  }

  escapeHtml(text) {
    if (!text) return '';
    let div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Register the custom element
customElements.define('hml-prompt', HmlPrompt);

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HmlPrompt;
}
