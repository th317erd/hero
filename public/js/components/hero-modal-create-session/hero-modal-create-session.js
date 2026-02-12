'use strict';

/**
 * Hero Modal Create Session
 * Modal for creating new chat sessions.
 */

import { HeroModal, GlobalState, escapeHtml } from '../hero-modal/hero-modal.js';

export class HeroModalCreateSession extends HeroModal {
  static tagName = 'hero-modal-create-session';

  get modalTitle() { return 'New Session'; }

  onOpen() {
    let agents = GlobalState.agents.valueOf() || [];
    if (agents.length === 0) {
      document.dispatchEvent(new CustomEvent('show-modal', {
        detail: { modal: 'create-agent' },
      }));
      return false;
    }
    return true;
  }

  getContent() {
    let agents = GlobalState.agents.valueOf() || [];

    let agentOptions = '<option value="">Select an agent...</option>';
    if (agents.length === 0) {
      agentOptions += '<option value="" disabled>No agents configured</option>';
    } else {
      for (let agent of agents) {
        agentOptions += `<option value="${agent.id}">${escapeHtml(agent.name)} (${agent.type})</option>`;
      }
    }

    return `
      <form autocomplete="off">
        <div class="form-group">
          <label for="session-name">Session Name</label>
          <input type="text" id="session-name" name="name" required placeholder="e.g., project-x" autocomplete="off">
        </div>
        <div class="form-group">
          <label for="session-agent">Agent</label>
          <select id="session-agent" name="agentId" required>
            ${agentOptions}
          </select>
        </div>
        <div class="form-group">
          <label for="session-prompt">System Prompt (optional)</label>
          <textarea id="session-prompt" name="systemPrompt" rows="3" placeholder="Instructions for the AI agent..."></textarea>
        </div>
      </form>
      <footer slot="footer">
        <button type="button" class="button button-secondary">Cancel</button>
        <button type="submit" class="button button-primary">Create</button>
      </footer>
    `;
  }

  async handleSubmit(event) {
    event.preventDefault();

    let form = this.querySelector('form');
    let name = form.querySelector('[name="name"]').value.trim();
    let agentId = parseInt(form.querySelector('[name="agentId"]').value, 10);
    let systemPrompt = form.querySelector('[name="systemPrompt"]').value.trim() || null;

    if (!name || !agentId) {
      this.error = 'Please fill in all required fields';
      return;
    }

    try {
      let { createSession } = window;
      let session = await createSession(name, agentId, systemPrompt);

      this.close();

      this.dispatchEvent(new CustomEvent('hero:navigate', {
        detail: { path: `/sessions/${session.id}` },
        bubbles: true,
        composed: true,
      }));
    } catch (error) {
      this.error = error.message;
    }
  }

  mounted() {
    super.mounted();

    document.addEventListener('show-modal', (event) => {
      if (event.detail.modal === 'create-session' || event.detail.modal === 'new-session') {
        this.openModal();
      }
    });
  }
}

// Register component
if (typeof customElements !== 'undefined') {
  if (!customElements.get('hero-modal-create-session')) {
    customElements.define('hero-modal-create-session', HeroModalCreateSession);
  }
}
