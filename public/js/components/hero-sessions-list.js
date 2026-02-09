'use strict';

/**
 * Hero Sessions List Component
 *
 * Displays:
 * - List of chat sessions
 * - Search/filter functionality
 * - Archive/restore actions
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
 * Escape HTML special characters.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  let div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format a date as relative time.
 * @param {string} dateString
 * @returns {string}
 */
function formatRelativeDate(dateString) {
  let date    = new Date(dateString);
  let now     = new Date();
  let diffMs  = now - date;
  let diffMin = Math.floor(diffMs / 60000);
  let diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 5) return 'just now';

  let timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (diffDay < 1 && date.getDate() === now.getDate()) return timeStr;
  if (diffDay < 2 && date.getDate() === now.getDate() - 1) return `yesterday ${timeStr}`;

  if (diffDay < 7) {
    let dayName = date.toLocaleDateString([], { weekday: 'short' });
    return `${dayName} ${timeStr}`;
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` ${timeStr}`;
}

/**
 * Format cost for display.
 * @param {number} cost
 * @returns {string}
 */
function formatCost(cost) {
  return '$' + cost.toFixed(2);
}

// ============================================================================
// HeroSessionsList Component
// ============================================================================

export class HeroSessionsList extends HeroComponent {
  static tagName = 'hero-sessions-list';

  // Local state
  #searchQuery = '';
  #unsubscribers = [];

  /**
   * Get visible sessions based on filters.
   * @returns {Array}
   */
  get visibleSessions() {
    let sessions    = GlobalState.sessions.valueOf() || [];
    let showHidden  = GlobalState.showHiddenSessions.valueOf();

    // Filter by visibility
    let visible = sessions.filter((s) =>
      (showHidden) ? true : (s.status !== 'archived' && s.status !== 'agent')
    );

    // Filter by search query
    if (this.#searchQuery) {
      let query = this.#searchQuery.toLowerCase();
      visible = visible.filter((s) =>
        s.name.toLowerCase().includes(query) ||
        (s.preview && s.preview.toLowerCase().includes(query))
      );
    }

    return visible;
  }

  /**
   * Determine empty state type.
   * @returns {string|null} 'no-agents' | 'no-sessions' | 'no-results' | null
   */
  get emptyState() {
    let sessions = GlobalState.sessions.valueOf() || [];
    let agents   = GlobalState.agents.valueOf() || [];
    let visible  = this.visibleSessions;

    if (sessions.length === 0 && agents.length === 0) return 'no-agents';
    if (sessions.length === 0) return 'no-sessions';
    if (visible.length === 0 && this.#searchQuery) return 'no-results';
    if (visible.length === 0) return 'no-sessions';

    return null;
  }

  /**
   * Component mounted.
   */
  mounted() {
    // Subscribe to state changes
    this.#unsubscribers.push(
      this.subscribeGlobal('sessions', () => this.render()),
      this.subscribeGlobal('agents', () => this.render()),
      this.subscribeGlobal('showHiddenSessions', () => this.render()),
      this.subscribeGlobal('globalSpend', () => this.#updateCostDisplay())
    );

    // Initial render
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
   * Set search query and re-render.
   * @param {string} query
   */
  setSearchQuery(query) {
    this.#searchQuery = query;
    this.render();
  }

  /**
   * Toggle show hidden sessions.
   */
  toggleHidden() {
    let current = GlobalState.showHiddenSessions.valueOf();
    this.setGlobal('showHiddenSessions', !current);
  }

  /**
   * Navigate to a session.
   * @param {number} sessionId
   */
  navigateToSession(sessionId) {
    this.dispatchEvent(new CustomEvent('hero:navigate', {
      detail: { path: `/sessions/${sessionId}` },
      bubbles: true,
    }));
  }

  /**
   * Archive or restore a session.
   * @param {number} sessionId
   * @param {boolean} isArchived
   */
  async toggleArchive(sessionId, isArchived) {
    try {
      let { archiveSession, unarchiveSession, fetchSessions } = await import('../api.js');

      if (isArchived) {
        await unarchiveSession(sessionId);
      } else {
        await archiveSession(sessionId);
      }

      // Refresh sessions
      let sessions = await fetchSessions();
      this.setGlobal('sessions', sessions);
    } catch (error) {
      console.error('Failed to toggle archive:', error);
    }
  }

  /**
   * Show new session modal.
   */
  showNewSessionModal() {
    this.dispatchEvent(new CustomEvent('hero:show-modal', {
      detail: { modal: 'new-session' },
      bubbles: true,
    }));
  }

  /**
   * Show new agent modal.
   */
  showNewAgentModal() {
    this.dispatchEvent(new CustomEvent('hero:show-modal', {
      detail: { modal: 'new-agent' },
      bubbles: true,
    }));
  }

  /**
   * Logout.
   */
  logout() {
    this.dispatchEvent(new CustomEvent('hero:logout', { bubbles: true }));
  }

  /**
   * Update cost display.
   */
  #updateCostDisplay() {
    let costEl = this.querySelector('.global-cost');
    if (costEl) {
      let spend = GlobalState.globalSpend.valueOf();
      costEl.textContent = formatCost(spend.cost || 0);
    }
  }

  /**
   * Render the component.
   */
  render() {
    let emptyState = this.emptyState;

    if (emptyState) {
      HeroComponent.prototype.render.call(this, this.#renderEmptyState(emptyState));
      this.#bindEvents();
      return;
    }

    let sessions = this.visibleSessions;
    let showHidden = GlobalState.showHiddenSessions.valueOf();
    let toggleIcon = (showHidden) ? '🐵' : '🙈';
    let toggleTitle = (showHidden) ? 'Hide archived sessions' : 'Show archived sessions';

    let html = `
      <div class="sidebar-header">
        <input type="text"
               class="session-search"
               placeholder="Search sessions..."
               value="${escapeHtml(this.#searchQuery)}"
               autocomplete="off">
        <button class="toggle-archived ${(showHidden) ? 'active' : ''}"
                title="${escapeHtml(toggleTitle)}">
          ${toggleIcon}
        </button>
      </div>
      <div class="sessions-list">
        ${sessions.map((s) => this.#renderSession(s)).join('')}
      </div>
    `;

    HeroComponent.prototype.render.call(this, html);
    this.#bindEvents();
  }

  /**
   * Bind event listeners after render.
   */
  #bindEvents() {
    // Search input
    let searchInput = this.querySelector('.session-search');
    if (searchInput) {
      searchInput.oninput = (e) => this.setSearchQuery(e.target.value);
    }

    // Toggle archived button
    let toggleBtn = this.querySelector('.toggle-archived');
    if (toggleBtn) {
      toggleBtn.onclick = () => this.toggleHidden();
    }

    // Session rows - navigate on click
    let sessionInfos = this.querySelectorAll('.session-info');
    for (let info of sessionInfos) {
      let sessionId = info.closest('.session-row')?.dataset.sessionId;
      if (sessionId) {
        info.onclick = () => this.navigateToSession(parseInt(sessionId, 10));
      }
    }

    // Archive buttons - using data-event-onclick, no manual binding needed

    // Empty state buttons
    let newSessionBtn = this.querySelector('.new-session-button');
    if (newSessionBtn) {
      newSessionBtn.onclick = () => this.showNewSessionModal();
    }

    let addAgentLink = this.querySelector('.no-agents-link');
    if (addAgentLink) {
      addAgentLink.onclick = () => this.showNewAgentModal();
    }
  }

  /**
   * Render a single session row.
   * @param {object} session
   * @returns {string}
   */
  #renderSession(session) {
    let statusClass = '';
    if (session.status === 'archived') statusClass = 'archived';
    else if (session.status === 'agent') statusClass = 'agent-session';

    let depthStyle = (session.depth > 0) ? `style="margin-left: ${session.depth * 24}px"` : '';
    let childClass = (session.depth > 0) ? 'child-session' : '';

    let isArchived   = session.status === 'archived';
    let archiveIcon  = (isArchived) ? '♻️' : '🗑️';
    let archiveTitle = (isArchived) ? 'Restore session' : 'Archive session';

    let dateStr   = formatRelativeDate(session.updatedAt);
    let preview   = session.preview || '';
    let msgCount  = session.messageCount || 0;
    let msgLabel  = (msgCount === 1) ? '1 message' : `${msgCount} messages`;
    let agentName = session.agent?.name || 'Unknown';

    let statusBadge = (session.status === 'agent')
      ? '<span class="session-status-badge agent">agent</span>'
      : '';

    return `
      <div class="session-row ${statusClass} ${childClass}" data-session-id="${session.id}" ${depthStyle}>
        <div class="session-info">
          <div class="session-title">${escapeHtml(session.name)}${statusBadge}</div>
          <div class="session-preview">${(preview) ? escapeHtml(preview) : '<span class="no-preview">No messages yet</span>'}</div>
          <div class="session-message-count">${escapeHtml(msgLabel)}</div>
        </div>
        <div class="session-meta">
          <span class="session-date">${escapeHtml(dateStr)}</span>
          <span class="session-agent">${escapeHtml(agentName)}</span>
        </div>
        <div class="session-actions">
          <button class="session-archive-button"
                  data-event-onclick="event.stopPropagation(); toggleArchive(${session.id}, ${isArchived})"
                  title="${escapeHtml(archiveTitle)}">
            ${archiveIcon}
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Render empty state.
   * @param {string} state
   * @returns {string}
   */
  #renderEmptyState(state) {
    switch (state) {
      case 'no-agents':
        return `
          <div class="no-sessions">
            <p>No agents configured yet.</p>
            <p><span class="no-agents-link">Add an Agent</span> to get started.</p>
          </div>
        `;
      case 'no-sessions':
        return `
          <div class="no-sessions">
            <p>No sessions yet.</p>
            <p>Click "New Session" to start chatting with an AI agent.</p>
            <button class="new-session-button">
              New Session
            </button>
          </div>
        `;
      case 'no-results':
        return `
          <div class="sidebar-header">
            <input type="text"
                   class="session-search"
                   placeholder="Search sessions..."
                   value="${escapeHtml(this.#searchQuery)}"
                   autocomplete="off">
          </div>
          <div class="no-sessions">
            <p>No sessions match your search.</p>
          </div>
        `;
      default:
        return '';
    }
  }
}

// Register the component
if (typeof customElements !== 'undefined') {
  customElements.define(HeroSessionsList.tagName, HeroSessionsList);
}
