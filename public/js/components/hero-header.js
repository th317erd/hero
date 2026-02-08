'use strict';

/**
 * Hero Header - Top Bar Component
 *
 * Displays:
 * - Session title (in chat view)
 * - Usage/cost display
 * - Session dropdown (in chat view)
 * - Action buttons (back, logout, abilities, agents)
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

function formatCost(cost) {
  return '$' + (cost || 0).toFixed(2);
}

// ============================================================================
// HeroHeader Component
// ============================================================================

export class HeroHeader extends HeroComponent {
  static tagName = 'hero-header';

  // Component state
  #view = 'sessions';
  #serviceSpend = { cost: 0 };
  #sessionSpend = { cost: 0 };
  #unsubscribers = [];

  /**
   * Get current view.
   * @returns {string}
   */
  get view() {
    return this.#view;
  }

  /**
   * Set current view.
   * @param {string} val
   */
  set view(val) {
    this.#view = val;
    this.render();
  }

  /**
   * Get session title.
   * @returns {string}
   */
  get title() {
    if (this.#view === 'chat') {
      return this.currentSession?.name || 'Chat';
    }
    return 'Hero';
  }

  /**
   * Get agent name.
   * @returns {string}
   */
  get agentName() {
    return this.currentSession?.agent?.name || 'Unknown';
  }

  /**
   * Component mounted.
   */
  mounted() {
    // Subscribe to state changes
    this.#unsubscribers.push(
      this.subscribeGlobal('currentSession', () => this.render()),
      this.subscribeGlobal('sessions', () => this.render()),
      this.subscribeGlobal('globalSpend', () => this.#updateCostDisplay()),
      this.subscribeGlobal('wsConnected', () => this.render())
    );

    // Listen for view changes from hero-app
    document.addEventListener('viewchange', (e) => {
      this.view = e.detail.view;
    });

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
  }

  /**
   * Set service and session spend.
   * @param {object} service
   * @param {object} session
   */
  setSpend(service, session) {
    this.#serviceSpend = service || { cost: 0 };
    this.#sessionSpend = session || { cost: 0 };
    this.#updateCostDisplay();
  }

  /**
   * Update cost display elements.
   */
  #updateCostDisplay() {
    let globalEl  = this.querySelector('.global-cost');
    let serviceEl = this.querySelector('.service-cost');
    let sessionEl = this.querySelector('.session-cost');

    if (globalEl) {
      let spend = GlobalState.globalSpend.valueOf();
      globalEl.textContent = formatCost(spend.cost);
    }
    if (serviceEl) {
      serviceEl.textContent = formatCost(this.#serviceSpend.cost);
    }
    if (sessionEl) {
      sessionEl.textContent = formatCost(this.#sessionSpend.cost);
    }
  }

  /**
   * Navigate back to sessions.
   */
  goBack() {
    this.dispatchEvent(new CustomEvent('navigate', {
      detail: { path: '/' },
      bubbles: true,
    }));
  }

  /**
   * Logout user.
   */
  logout() {
    this.dispatchEvent(new CustomEvent('logout', { bubbles: true }));
  }

  /**
   * Show abilities modal.
   */
  showAbilities() {
    this.dispatchEvent(new CustomEvent('show-modal', {
      detail: { modal: 'abilities' },
      bubbles: true,
    }));
  }

  /**
   * Show agents modal.
   */
  showAgents() {
    this.dispatchEvent(new CustomEvent('show-modal', {
      detail: { modal: 'agents' },
      bubbles: true,
    }));
  }

  /**
   * Handle session select change.
   * @param {Event} e
   */
  #handleSessionChange(e) {
    let sessionId = parseInt(e.target.value, 10);
    if (sessionId) {
      this.dispatchEvent(new CustomEvent('navigate', {
        detail: { path: `/sessions/${sessionId}` },
        bubbles: true,
      }));
    }
  }

  /**
   * Render the component.
   */
  render() {
    if (this.#view === 'login') {
      this.innerHTML = '';
      return;
    }

    let globalSpend  = GlobalState.globalSpend.valueOf();
    let sessions     = GlobalState.sessions.valueOf() || [];
    let wsConnected  = GlobalState.wsConnected.valueOf();

    let usageHtml = this.#renderUsage(globalSpend);
    let actionsHtml = this.#renderActions();

    this.innerHTML = `
      <header class="header">
        <div class="header-left">
          ${this.#view === 'chat' ? `
            <button class="back-btn" onclick="this.closest('hero-header').goBack()">← Back</button>
          ` : ''}
          <h1 class="header-title">${escapeHtml(this.title)}</h1>
          ${this.#view === 'chat' && this.currentSession ? `
            <span class="header-agent">(${escapeHtml(this.agentName)})</span>
          ` : ''}
          ${wsConnected ? '' : '<span class="ws-status disconnected">⚠ Disconnected</span>'}
        </div>
        ${usageHtml}
        <div class="header-actions">
          ${actionsHtml}
        </div>
      </header>
    `;

    // Attach session select handler if present
    let sessionSelect = this.querySelector('.session-select');
    if (sessionSelect) {
      sessionSelect.addEventListener('change', (e) => this.#handleSessionChange(e));
    }
  }

  /**
   * Render usage display.
   * @param {object} globalSpend
   * @returns {string}
   */
  #renderUsage(globalSpend) {
    if (this.#view === 'sessions') {
      return `
        <div class="header-usage">
          <div class="usage-item" title="Total usage across all agents">
            <span class="usage-label">Global Spend:</span>
            <span class="usage-cost global-cost">${formatCost(globalSpend.cost)}</span>
          </div>
        </div>
      `;
    }

    if (this.#view === 'chat') {
      return `
        <div class="header-usage">
          <div class="usage-item" title="Total usage across all agents">
            <span class="usage-label">Global Spend:</span>
            <span class="usage-cost global-cost">${formatCost(globalSpend.cost)}</span>
          </div>
          <div class="usage-item usage-service" title="Usage for this API key/service">
            <span class="usage-label">Service Spend:</span>
            <span class="usage-cost service-cost">${formatCost(this.#serviceSpend.cost)}</span>
          </div>
          <div class="usage-item usage-session" title="Usage in this session">
            <span class="usage-label">Session Spend:</span>
            <span class="usage-cost session-cost">${formatCost(this.#sessionSpend.cost)}</span>
          </div>
        </div>
      `;
    }

    return '';
  }

  /**
   * Render action buttons.
   * @returns {string}
   */
  #renderActions() {
    if (this.#view === 'sessions') {
      return `
        <button class="abilities-btn" onclick="this.closest('hero-header').showAbilities()">
          Abilities
        </button>
        <button class="agents-btn" onclick="this.closest('hero-header').showAgents()">
          Agents
        </button>
        <button class="logout-btn" onclick="this.closest('hero-header').logout()">
          Logout
        </button>
      `;
    }

    if (this.#view === 'chat') {
      let sessions = GlobalState.sessions.valueOf() || [];
      let currentId = this.currentSession?.id;

      let optionsHtml = '<option value="">Switch session...</option>';
      for (let session of sessions) {
        let selected = (session.id === currentId) ? 'selected' : '';
        optionsHtml += `<option value="${session.id}" ${selected}>${escapeHtml(session.name)}</option>`;
      }

      return `
        <select class="session-select">
          ${optionsHtml}
        </select>
        <button class="logout-btn" onclick="this.closest('hero-header').logout()">
          Logout
        </button>
      `;
    }

    return '';
  }
}

// Register the component
if (typeof customElements !== 'undefined') {
  customElements.define(HeroHeader.tagName, HeroHeader);
}
