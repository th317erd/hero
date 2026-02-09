'use strict';

/**
 * Hero Main Controls - Header Action Buttons Component
 *
 * Displays:
 * - Agents button (always)
 * - Abilities button (always)
 * - New Session button (always)
 * - Logout button (always)
 * - Session dropdown (chat view only)
 * - Show hidden toggle (chat view only)
 * - Clear button (chat view only)
 *
 * Supports two layouts via attribute:
 * - layout="horizontal" (default, desktop)
 * - layout="vertical" (mobile menu)
 *
 * Context attribute controls which controls are shown:
 * - context="sessions" (default) - nav buttons only
 * - context="chat" - nav buttons + session controls
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

// ============================================================================
// HeroMainControls Component
// ============================================================================

export class HeroMainControls extends HeroComponent {
  static tagName = 'hero-main-controls';

  // Observed attributes
  static get observedAttributes() {
    return ['layout', 'context'];
  }

  #unsubscribers = [];

  // -------------------------------------------------------------------------
  // Attribute Getters/Setters
  // -------------------------------------------------------------------------

  get layout() {
    return this.getAttribute('layout') || 'horizontal';
  }

  set layout(val) {
    this.setAttribute('layout', val);
  }

  get context() {
    return this.getAttribute('context') || 'sessions';
  }

  set context(val) {
    this.setAttribute('context', val);
  }

  get inSession() {
    return this.context === 'chat';
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue) {
      this.render();
    }
  }

  mounted() {
    // Subscribe to state changes
    this.#unsubscribers.push(
      this.subscribeGlobal('sessions', () => this.render()),
      this.subscribeGlobal('currentSession', () => this.render())
    );

    this.render();
  }

  unmounted() {
    for (let unsub of this.#unsubscribers) {
      unsub();
    }
    this.#unsubscribers = [];
  }

  // -------------------------------------------------------------------------
  // Action Methods
  // -------------------------------------------------------------------------

  showAgents() {
    this.#dispatchMenuAction();
    this.dispatchEvent(new CustomEvent('show-modal', {
      detail: { modal: 'agents' },
      bubbles: true,
    }));
  }

  showAbilities() {
    this.#dispatchMenuAction();
    this.dispatchEvent(new CustomEvent('show-modal', {
      detail: { modal: 'abilities' },
      bubbles: true,
    }));
  }

  newSession() {
    this.#dispatchMenuAction();
    this.dispatchEvent(new CustomEvent('show-modal', {
      detail: { modal: 'new-session' },
      bubbles: true,
    }));
  }

  logout() {
    this.#dispatchMenuAction();
    this.dispatchEvent(new CustomEvent('hero:logout', { bubbles: true }));
  }

  clearMessages() {
    this.#dispatchMenuAction();
    this.dispatchEvent(new CustomEvent('hero:clear-messages', { bubbles: true }));
  }

  /**
   * Dispatch event to notify parent (hero-header) that a menu action was taken.
   * This allows the mobile menu to close after an action.
   */
  #dispatchMenuAction() {
    this.dispatchEvent(new CustomEvent('hero:menu-action', { bubbles: true }));
  }

  // -------------------------------------------------------------------------
  // Event Handlers
  // -------------------------------------------------------------------------

  #handleSessionChange(e) {
    let sessionId = parseInt(e.target.value, 10);
    if (sessionId) {
      this.#dispatchMenuAction();
      this.dispatchEvent(new CustomEvent('hero:navigate', {
        detail: { path: `/sessions/${sessionId}` },
        bubbles: true,
      }));
    }
  }

  #handleShowHiddenToggle(e) {
    this.dispatchEvent(new CustomEvent('hero:toggle-hidden', {
      detail: { show: e.target.checked },
      bubbles: true,
    }));
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  render() {
    let isVertical = this.layout === 'vertical';

    let html = (isVertical)
      ? this.#renderVertical()
      : this.#renderHorizontal();

    HeroComponent.prototype.render.call(this, html);

    // Attach change handlers for select/checkbox
    let sessionSelect = this.querySelector('.session-select');
    if (sessionSelect) {
      sessionSelect.addEventListener('change', (e) => this.#handleSessionChange(e));
    }

    let showHiddenToggle = this.querySelector('.show-hidden-toggle');
    if (showHiddenToggle) {
      showHiddenToggle.addEventListener('change', (e) => this.#handleShowHiddenToggle(e));
    }
  }

  #renderHorizontal() {
    let sessionControls = '';

    if (this.inSession) {
      sessionControls = this.#renderSessionControls();
    }

    return `
      <div class="main-controls main-controls-horizontal">
        <button class="button button-secondary" data-event-onclick="showAgents">Agents</button>
        <button class="button button-secondary" data-event-onclick="showAbilities">Abilities</button>
        <button class="button button-primary" data-event-onclick="newSession">New Session</button>
        ${sessionControls}
        <button class="button button-secondary" data-event-onclick="logout">Logout</button>
      </div>
    `;
  }

  #renderVertical() {
    let sessionControls = '';

    if (this.inSession) {
      sessionControls = `
        <button class="mobile-menu-item" data-event-onclick="clearMessages">Clear Messages</button>
      `;
    }

    return `
      <div class="main-controls main-controls-vertical">
        <button class="mobile-menu-item" data-event-onclick="showAgents">Agents</button>
        <button class="mobile-menu-item" data-event-onclick="showAbilities">Abilities</button>
        <button class="mobile-menu-item" data-event-onclick="newSession">New Session</button>
        ${sessionControls}
        <button class="mobile-menu-item" data-event-onclick="logout">Logout</button>
      </div>
    `;
  }

  #renderSessionControls() {
    let sessions = GlobalState.sessions.valueOf() || [];
    let currentId = this.currentSession?.id;

    let optionsHtml = '<option value="">Switch session...</option>';
    for (let session of sessions) {
      let selected = (session.id === currentId) ? 'selected' : '';
      optionsHtml += `<option value="${session.id}" ${selected}>${escapeHtml(session.name)}</option>`;
    }

    return `
      <label class="checkbox-label">
        <input type="checkbox" class="show-hidden-toggle">
        <span>Show hidden</span>
      </label>
      <select class="session-select">
        ${optionsHtml}
      </select>
      <button class="button button-secondary" data-event-onclick="clearMessages">Clear</button>
    `;
  }
}

// Register the component
if (typeof customElements !== 'undefined') {
  customElements.define(HeroMainControls.tagName, HeroMainControls);
}
