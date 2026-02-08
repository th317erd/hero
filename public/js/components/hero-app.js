'use strict';

/**
 * Hero App - Root Component
 *
 * Handles:
 * - Routing between views (login, sessions, chat)
 * - Authentication state
 * - WebSocket connection lifecycle
 * - Initial data loading
 */

import {
  HeroComponent,
  GlobalState,
  DynamicProperty,
} from './hero-base.js';

// ============================================================================
// Route Parsing
// ============================================================================

/**
 * Parse a pathname into a route object.
 * @param {string} pathname - The URL pathname
 * @param {string} basePath - Optional base path to strip
 * @returns {{ view: string, sessionId?: number }}
 */
export function parseRoute(pathname, basePath = '') {
  let path = pathname;

  // Strip base path
  if (basePath && path.startsWith(basePath)) {
    path = path.slice(basePath.length) || '/';
  }

  if (path === '/login') {
    return { view: 'login' };
  }

  if (path === '/' || path === '') {
    return { view: 'sessions' };
  }

  let sessionMatch = path.match(/^\/sessions\/(\d+)$/);

  if (sessionMatch) {
    return { view: 'chat', sessionId: parseInt(sessionMatch[1], 10) };
  }

  // Unknown route defaults to sessions
  return { view: 'sessions' };
}

// ============================================================================
// HeroApp Component
// ============================================================================

export class HeroApp extends HeroComponent {
  static tagName = 'hero-app';

  // Current view state
  #currentView = 'login';
  #basePath = '';
  #unsubscribers = [];

  /**
   * Get the base path from <base> tag.
   * @returns {string}
   */
  get basePath() {
    return this.#basePath;
  }

  /**
   * Get the current view name.
   * @returns {string}
   */
  get currentView() {
    return this.#currentView;
  }

  /**
   * Component mounted - initialize routing and auth.
   */
  mounted() {
    // Read base path from <base> tag
    let baseHref = document.querySelector('base')?.getAttribute('href') || '';
    this.#basePath = baseHref.replace(/\/$/, '');

    // Listen for popstate (back/forward navigation)
    window.addEventListener('popstate', this.#handlePopState);

    // Subscribe to user changes for auth state
    let unsubUser = this.subscribeGlobal('user', ({ value }) => {
      this.#onUserChange(value);
    });
    this.#unsubscribers.push(unsubUser);

    // Initial route
    this.handleRoute();
  }

  /**
   * Component unmounted - cleanup.
   */
  unmounted() {
    window.removeEventListener('popstate', this.#handlePopState);

    // Cleanup subscriptions
    for (let unsub of this.#unsubscribers) {
      unsub();
    }
    this.#unsubscribers = [];
  }

  /**
   * Handle popstate events.
   */
  #handlePopState = () => {
    this.handleRoute();
  };

  /**
   * Handle user state changes.
   * @param {object|null} user
   */
  #onUserChange(user) {
    if (!user && this.#currentView !== 'login') {
      // User logged out, redirect to login
      this.navigate('/login');
    }
  }

  /**
   * Navigate to a path.
   * @param {string} path - Path to navigate to
   */
  navigate(path) {
    window.history.pushState({}, '', this.#basePath + path);
    this.handleRoute();
  }

  /**
   * Handle the current route.
   */
  async handleRoute() {
    let route = parseRoute(window.location.pathname, this.#basePath);

    // Check auth for protected routes
    if (route.view !== 'login') {
      let isAuthenticated = await this.#checkAuth();

      if (!isAuthenticated) {
        this.#showView('login');
        return;
      }
    }

    switch (route.view) {
      case 'login':
        this.#disconnectWebSocket();
        this.#showView('login');
        break;

      case 'sessions':
        await this.#loadInitialData();
        this.#showView('sessions');
        break;

      case 'chat':
        await this.#loadSession(route.sessionId);
        this.#showView('chat');
        break;

      default:
        this.#showView('sessions');
    }
  }

  /**
   * Check if user is authenticated.
   * @returns {Promise<boolean>}
   */
  async #checkAuth() {
    try {
      // Import fetchMe from api.js
      let { fetchMe } = await import('../api.js');
      let user = await fetchMe();
      this.setGlobal('user', user);
      this.#connectWebSocket();
      return true;
    } catch (error) {
      this.setGlobal('user', null);
      return false;
    }
  }

  /**
   * Load initial data (sessions, agents, abilities).
   */
  async #loadInitialData() {
    try {
      let { fetchSessions, fetchAgents, fetchAbilities, fetchUsage } = await import('../api.js');

      // Load in parallel
      let [sessions, agents, abilities, usage] = await Promise.all([
        fetchSessions(),
        fetchAgents(),
        fetchAbilities(),
        fetchUsage().catch(() => ({ global: { cost: 0 } })),
      ]);

      this.setGlobal('sessions', sessions);
      this.setGlobal('agents', agents);
      this.setGlobal('abilities', abilities);
      this.setGlobal('globalSpend', { cost: usage.global?.cost || 0, inputTokens: 0, outputTokens: 0 });
    } catch (error) {
      console.error('Failed to load initial data:', error);
    }
  }

  /**
   * Load a specific session.
   * @param {number} sessionId
   */
  async #loadSession(sessionId) {
    try {
      let { fetchSession, fetchSessionUsage } = await import('../api.js');

      let session = await fetchSession(sessionId);
      this.setGlobal('currentSession', session);

      // Also load session usage
      try {
        let usage = await fetchSessionUsage(sessionId);
        this.setGlobal('globalSpend', { cost: usage.global?.cost || 0, inputTokens: 0, outputTokens: 0 });
      } catch (e) {
        // Usage load failure is non-fatal
      }
    } catch (error) {
      console.error('Failed to load session:', error);
      this.navigate('/');
    }
  }

  /**
   * Show a view and hide others.
   * @param {string} viewName
   */
  #showView(viewName) {
    this.#currentView = viewName;

    // Dispatch event for view changes
    this.dispatchEvent(new CustomEvent('viewchange', {
      detail: { view: viewName },
      bubbles: true,
    }));

    // Update view visibility via child components or DOM
    let views = this.querySelectorAll('[data-view]');
    for (let view of views) {
      let isActive = view.dataset.view === viewName;
      view.style.display = isActive ? '' : 'none';
    }
  }

  /**
   * Connect WebSocket.
   */
  #connectWebSocket() {
    // WebSocket connection will be handled by hero-websocket component
    this.setGlobal('wsConnected', true);
    this.dispatchEvent(new CustomEvent('ws:connect', { bubbles: true }));
  }

  /**
   * Disconnect WebSocket.
   */
  #disconnectWebSocket() {
    this.setGlobal('wsConnected', false);
    this.dispatchEvent(new CustomEvent('ws:disconnect', { bubbles: true }));
  }

  /**
   * Logout the user.
   */
  async logout() {
    try {
      let { logout: apiLogout } = await import('../api.js');
      await apiLogout();
    } catch (e) {
      // Logout API failure is non-fatal
    }

    // Clear state
    this.setGlobal('user', null);
    this.setGlobal('sessions', []);
    this.setGlobal('agents', []);
    this.setGlobal('abilities', { system: [], user: [] });
    this.setGlobal('currentSession', null);

    this.#disconnectWebSocket();
    this.navigate('/login');
  }
}

// Register the component
if (typeof customElements !== 'undefined') {
  customElements.define(HeroApp.tagName, HeroApp);
}
