'use strict';

/**
 * Hero Status Bar - Bottom Status Bar Component
 *
 * Displays:
 * - Connection status (Connected/Disconnected)
 * - Global Spend
 * - Service Spend (N/A when not in session)
 * - Session Spend (N/A when not in session)
 */

import {
  HeroComponent,
  GlobalState,
  DynamicProperty,
} from './hero-base.js';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format cost with 3-digit padding.
 * @param {number} cost
 * @returns {string}
 */
function formatCost(cost) {
  let value = cost || 0;
  let dollars = Math.floor(value);
  let cents = Math.round((value - dollars) * 100);
  return '$' + String(dollars).padStart(3, '0') + '.' + String(cents).padStart(2, '0');
}

// ============================================================================
// HeroStatusBar Component
// ============================================================================

export class HeroStatusBar extends HeroComponent {
  static tagName = 'hero-status-bar';

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
   * Check if currently in a session.
   * @returns {boolean}
   */
  get inSession() {
    return this.#view === 'chat' && this.currentSession !== null;
  }

  /**
   * Component mounted.
   */
  mounted() {
    // Subscribe to state changes
    this.#unsubscribers.push(
      this.subscribeGlobal('currentSession', () => this.render()),
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
    let globalEl = this.querySelector('.spend-global .spend-value');
    let serviceEl = this.querySelector('.spend-service .spend-value');
    let sessionEl = this.querySelector('.spend-session .spend-value');

    if (globalEl) {
      let spend = GlobalState.globalSpend.valueOf();
      globalEl.textContent = formatCost(spend.cost);
    }

    if (serviceEl && this.inSession) {
      serviceEl.textContent = formatCost(this.#serviceSpend.cost);
    }

    if (sessionEl && this.inSession) {
      sessionEl.textContent = formatCost(this.#sessionSpend.cost);
    }
  }

  /**
   * Render the component.
   */
  render() {
    // Don't show on login view
    if (this.#view === 'login') {
      this.innerHTML = '';
      return;
    }

    let wsConnected = GlobalState.wsConnected.valueOf();
    let globalSpend = GlobalState.globalSpend.valueOf();
    let inSession = this.inSession;

    let connectionClass = wsConnected ? 'connected' : 'disconnected';
    let connectionText = wsConnected ? 'Connected' : 'Disconnected';
    let connectionIcon = wsConnected ? '●' : '⚠';

    // Service and Session: show values if in session, otherwise N/A grayed out
    let serviceValue = inSession ? formatCost(this.#serviceSpend.cost) : 'N/A';
    let sessionValue = inSession ? formatCost(this.#sessionSpend.cost) : 'N/A';
    let disabledClass = inSession ? '' : 'spend-disabled';

    HeroComponent.prototype.render.call(this, `
      <div class="status-bar">
        <span class="connection-status ${connectionClass}" title="WebSocket connection status">
          <span class="connection-icon">${connectionIcon}</span>
          <span class="connection-text">${connectionText}</span>
        </span>
        <span class="status-separator">|</span>
        <span class="spend-item spend-global" title="Total usage across all agents">
          <span class="spend-label">Global:</span>
          <span class="spend-value">${formatCost(globalSpend.cost)}</span>
        </span>
        <span class="status-separator">|</span>
        <span class="spend-item spend-service ${disabledClass}" title="Usage for this API key/service">
          <span class="spend-label">Service:</span>
          <span class="spend-value">${serviceValue}</span>
        </span>
        <span class="status-separator">|</span>
        <span class="spend-item spend-session ${disabledClass}" title="Usage in this session">
          <span class="spend-label">Session:</span>
          <span class="spend-value">${sessionValue}</span>
        </span>
      </div>
    `);
  }
}

// Register the component
if (typeof customElements !== 'undefined') {
  customElements.define(HeroStatusBar.tagName, HeroStatusBar);
}
