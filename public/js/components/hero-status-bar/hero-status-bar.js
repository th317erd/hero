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
} from '../hero-base.js';

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

  // ---------------------------------------------------------------------------
  // Shadow DOM (override HeroComponent default of Light DOM)
  // ---------------------------------------------------------------------------

  createShadowDOM() {
    return this.attachShadow({ mode: 'open' });
  }

  // ---------------------------------------------------------------------------
  // Template Expression Getters
  // ---------------------------------------------------------------------------

  get connectionClass() {
    let wsConnected = GlobalState.wsConnected.valueOf();
    return (wsConnected) ? 'connected' : 'disconnected';
  }

  get connectionIcon() {
    let wsConnected = GlobalState.wsConnected.valueOf();
    return (wsConnected) ? '\u25CF' : '\u26A0';
  }

  get connectionText() {
    let wsConnected = GlobalState.wsConnected.valueOf();
    return (wsConnected) ? 'Connected' : 'Disconnected';
  }

  get globalSpendFormatted() {
    let globalSpend = GlobalState.globalSpend.valueOf();
    return formatCost(globalSpend.cost);
  }

  get serviceSpendFormatted() {
    if (!this.inSession)
      return 'N/A';

    return formatCost(this.#serviceSpend.cost);
  }

  get sessionSpendFormatted() {
    if (!this.inSession)
      return 'N/A';

    return formatCost(this.#sessionSpend.cost);
  }

  get spendDisabledClass() {
    return (this.inSession) ? '' : 'spend-disabled';
  }

  // ---------------------------------------------------------------------------
  // Public Getters
  // ---------------------------------------------------------------------------

  /**
   * Get current view.
   * @returns {string}
   */
  get view() {
    return this.#view;
  }

  /**
   * Set current view.
   * @param {string} value
   */
  set view(value) {
    this.#view = value;
  }

  /**
   * Check if currently in a session.
   * @returns {boolean}
   */
  get inSession() {
    return this.#view === 'chat' && this.currentSession !== null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Component mounted.
   */
  mounted() {
    // Subscribe to state changes
    this.#unsubscribers.push(
      this.subscribeGlobal('currentSession', () => this.scheduleRender()),
      this.subscribeGlobal('globalSpend', () => this.scheduleRender()),
      this.subscribeGlobal('wsConnected', () => this.scheduleRender())
    );

    // Listen for view changes from hero-app
    document.addEventListener('viewchange', (event) => {
      this.view = event.detail.view;
      this.scheduleRender();
    });

    // Don't render on login view
    if (this.#view === 'login') {
      this.style.display = 'none';
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
  }

  // ---------------------------------------------------------------------------
  // Public Methods
  // ---------------------------------------------------------------------------

  /**
   * Set service and session spend.
   * @param {object} service
   * @param {object} session
   */
  setSpend(service, session) {
    this.#serviceSpend = service || { cost: 0 };
    this.#sessionSpend = session || { cost: 0 };
    this.scheduleRender();
  }

  /**
   * Schedule a render on next animation frame.
   * Prevents multiple renders in the same frame.
   */
  scheduleRender() {
    if (this._renderScheduled)
      return;

    this._renderScheduled = true;
    requestAnimationFrame(() => {
      this._renderScheduled = false;
      if (this.#view === 'login') {
        this.style.display = 'none';
      } else {
        this.style.display = '';
      }
    });
  }
}

// Register the component
HeroStatusBar.register();
