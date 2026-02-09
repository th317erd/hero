'use strict';

/**
 * Hero Header - Top Bar Component
 *
 * Displays:
 * - Session title (in chat view)
 * - Logo and title (in sessions view)
 * - Navigation controls via hero-main-controls
 * - Mobile hamburger menu
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
// HeroHeader Component
// ============================================================================

export class HeroHeader extends HeroComponent {
  static tagName = 'hero-header';

  // Component state
  #view = 'sessions';
  #mobileMenuOpen = false;
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
      this.subscribeGlobal('sessions', () => this.render())
    );

    // Listen for view changes from hero-app
    document.addEventListener('viewchange', (e) => {
      this.view = e.detail.view;
    });

    // Listen for menu actions from hero-main-controls to close mobile menu
    this.addEventListener('hero:menu-action', () => {
      this.closeMobileMenu();
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
   * Navigate back to sessions.
   */
  goBack() {
    this.dispatchEvent(new CustomEvent('hero:navigate', {
      detail: { path: '/' },
      bubbles: true,
    }));
  }

  /**
   * Toggle mobile menu.
   */
  toggleMobileMenu() {
    this.#mobileMenuOpen = !this.#mobileMenuOpen;
    let menu = this.querySelector('.mobile-menu');
    if (menu) {
      menu.classList.toggle('open', this.#mobileMenuOpen);
    }
    let hamburger = this.querySelector('.hamburger-button');
    if (hamburger) {
      hamburger.classList.toggle('active', this.#mobileMenuOpen);
    }
  }

  /**
   * Close mobile menu.
   */
  closeMobileMenu() {
    this.#mobileMenuOpen = false;
    let menu = this.querySelector('.mobile-menu');
    if (menu) {
      menu.classList.remove('open');
    }
    let hamburger = this.querySelector('.hamburger-button');
    if (hamburger) {
      hamburger.classList.remove('active');
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

    let context = (this.#view === 'chat') ? 'chat' : 'sessions';

    HeroComponent.prototype.render.call(this, `
      <header class="header">
        <div class="header-left">
          ${(this.#view === 'chat') ? `
            <button class="button button-icon back-button" data-event-onclick="goBack" title="Back to sessions">&larr;</button>
            <h1 class="header-title" id="session-title">${escapeHtml(this.title)}</h1>
          ` : `
            <img src="assets/images/hero-cape.svg?v=1" alt="Hero" class="logo">
            <h1 class="header-title">Hero</h1>
          `}
        </div>
        <div class="header-actions desktop-actions">
          <hero-main-controls layout="horizontal" context="${context}"></hero-main-controls>
        </div>
        <button class="button button-icon hamburger-button" data-event-onclick="toggleMobileMenu" title="Menu">
          <span class="hamburger-icon"></span>
        </button>
        <div class="mobile-menu">
          <hero-main-controls layout="vertical" context="${context}"></hero-main-controls>
        </div>
      </header>
    `);

    // Close mobile menu when clicking outside
    document.addEventListener('click', (e) => {
      if (this.#mobileMenuOpen && !this.contains(e.target)) {
        this.closeMobileMenu();
      }
    }, { once: true });
  }
}

// Register the component
if (typeof customElements !== 'undefined') {
  customElements.define(HeroHeader.tagName, HeroHeader);
}
