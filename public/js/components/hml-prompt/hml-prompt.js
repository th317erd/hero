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
      color: inherit;
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

    :host([answered]) .container {
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

  // Observed attributes
  static observedAttributes = ['answered', 'type'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._renderCount = 0;
    this._isRendering = false;
  }

  connectedCallback() {
    super.connectedCallback?.();
    this._renderCount = 0;
    if (this.getAttribute('answered') === 'false') {
      this.removeAttribute('answered');
    }
    this.render();
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    this._renderCount = 0;
    this._isRendering = false;
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue && this.isConnected && !this._isSubmitting) {
      this.render();
    }
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
    let val = this.getAttribute('answered');
    return val !== null && val !== 'false';
  }

  get question() {
    let clone = this.cloneNode(true);
    clone.querySelectorAll('response, option, opt, data').forEach((el) => el.remove());
    return clone.textContent.trim();
  }

  get response() {
    let responseEl = this.querySelector('response');
    return responseEl ? responseEl.textContent.trim() : '';
  }

  get options() {
    let dataEl = this.querySelector('data');
    if (dataEl) {
      try {
        // Decode HTML entities (markdown processors may encode quotes)
        let rawText = dataEl.textContent.trim();
        let decoded = this._decodeHtmlEntities(rawText);
        let parsed = JSON.parse(decoded);
        return parsed.map((opt) => ({
          value:    opt.value || opt.label || '',
          label:    opt.label || opt.value || '',
          selected: !!opt.selected,
        }));
      } catch (e) {
        console.warn('[hml-prompt] Failed to parse <data> JSON:', e);
      }
    }

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

    let optionEls = this.querySelectorAll('option, opt');
    return Array.from(optionEls).map((opt) => ({
      value:    opt.getAttribute('value') || opt.textContent.trim(),
      label:    opt.textContent.trim(),
      selected: opt.hasAttribute('selected'),
    }));
  }

  get min() { return this.getAttribute('min'); }
  get max() { return this.getAttribute('max'); }
  get step() { return this.getAttribute('step') || '1'; }
  get defaultValue() { return this.getAttribute('default'); }

  _generateId() {
    return 'prompt-' + Math.random().toString(36).substring(2, 10);
  }

  // ---------------------------------------------------------------------------
  // Render Methods
  // ---------------------------------------------------------------------------

  render() {
    if (this._isRendering) return;

    this._renderCount++;
    if (this._renderCount > 10) {
      console.error('[hml-prompt] Render loop detected!');
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
        e.preventDefault();
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
    input._handlingEnter = false;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (input._handlingEnter || e._hmlHandled) return;
        input._handlingEnter = true;
        e._hmlHandled = true;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        let answer = input.value.trim();
        if (answer) this._submitAnswer(answer);
        setTimeout(() => { input._handlingEnter = false; }, 100);
      }
    });
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

    submit._handlingClick = false;
    submit.addEventListener('click', (e) => {
      if (submit._handlingClick || e._hmlHandled) return;
      submit._handlingClick = true;
      e._hmlHandled = true;
      e.stopImmediatePropagation();
      this._submitAnswer(input.value);
      setTimeout(() => { submit._handlingClick = false; }, 100);
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

    submit._handlingClick = false;
    submit.addEventListener('click', (e) => {
      if (submit._handlingClick || e._hmlHandled) return;
      submit._handlingClick = true;
      e._hmlHandled = true;
      e.stopImmediatePropagation();
      this._submitAnswer(input.checked ? 'yes' : 'no');
      setTimeout(() => { submit._handlingClick = false; }, 100);
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
    submit._handlingClick = false;
    submit.addEventListener('click', (e) => {
      if (submit._handlingClick || e._hmlHandled) return;
      submit._handlingClick = true;
      e._hmlHandled = true;
      e.stopImmediatePropagation();
      let checked = this.shadowRoot.querySelectorAll(`input[name="${name}"]:checked`);
      let values = Array.from(checked).map((cb) => cb.value);
      if (values.length > 0) {
        this._submitAnswer(values.join(', '));
      }
      setTimeout(() => { submit._handlingClick = false; }, 100);
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
    submit._handlingClick = false;
    submit.addEventListener('click', (e) => {
      if (submit._handlingClick || e._hmlHandled) return;
      submit._handlingClick = true;
      e._hmlHandled = true;
      e.stopImmediatePropagation();
      let selected = this.shadowRoot.querySelector(`input[name="${name}"]:checked`);
      if (selected) {
        this._submitAnswer(selected.value);
      }
      setTimeout(() => { submit._handlingClick = false; }, 100);
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

    submit._handlingClick = false;
    submit.addEventListener('click', (e) => {
      if (submit._handlingClick || e._hmlHandled) return;
      submit._handlingClick = true;
      e._hmlHandled = true;
      e.stopImmediatePropagation();
      if (select.value) {
        this._submitAnswer(select.value);
      }
      setTimeout(() => { submit._handlingClick = false; }, 100);
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

    submit._handlingClick = false;
    submit.addEventListener('click', (e) => {
      if (submit._handlingClick || e._hmlHandled) return;
      submit._handlingClick = true;
      e._hmlHandled = true;
      e.stopImmediatePropagation();
      this._submitAnswer(input.value);
      setTimeout(() => { submit._handlingClick = false; }, 100);
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
    let messageId = (messageEl) ? parseInt(messageEl.dataset.messageId, 10) : null;

    if (this.isConnected) {
      this.innerHTML = `${question}<response>${this._escapeHtml(answer)}</response>`;
      this.setAttribute('answered', '');
      this._renderCount = 0;
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
