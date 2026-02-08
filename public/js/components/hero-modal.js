'use strict';

/**
 * Hero Modal - Base Modal Component
 *
 * Provides:
 * - Open/close behavior
 * - Escape key handling
 * - Backdrop click to close
 * - Form validation helpers
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
// HeroModal Base Class
// ============================================================================

export class HeroModal extends HeroComponent {
  static tagName = 'hero-modal';

  // Modal state
  #isOpen = false;
  #error = '';

  /**
   * Check if modal is open.
   * @returns {boolean}
   */
  get isOpen() {
    return this.#isOpen;
  }

  /**
   * Get current error message.
   * @returns {string}
   */
  get error() {
    return this.#error;
  }

  /**
   * Set error message.
   * @param {string} msg
   */
  set error(msg) {
    this.#error = msg;
    this.#updateError();
  }

  /**
   * Component mounted.
   */
  mounted() {
    // Listen for show-modal events
    document.addEventListener('show-modal', (e) => {
      if (e.detail.modal === this.modalName) {
        this.open();
      }
    });

    // Keyboard handler
    this.addEventListener('keydown', (e) => this.#handleKeydown(e));

    this.render();
  }

  /**
   * Get modal name (override in subclass).
   * @returns {string}
   */
  get modalName() {
    return 'modal';
  }

  /**
   * Get modal title (override in subclass).
   * @returns {string}
   */
  get modalTitle() {
    return 'Modal';
  }

  /**
   * Open the modal.
   */
  open() {
    this.#isOpen = true;
    this.#error = '';
    this.onOpen();
    this.render();
    this.style.display = 'flex';

    // Focus first input
    requestAnimationFrame(() => {
      let firstInput = this.querySelector('input, select, textarea');
      if (firstInput) firstInput.focus();
    });
  }

  /**
   * Close the modal.
   */
  close() {
    this.#isOpen = false;
    this.onClose();
    this.style.display = 'none';
  }

  /**
   * Hook called when modal opens (override in subclass).
   */
  onOpen() {}

  /**
   * Hook called when modal closes (override in subclass).
   */
  onClose() {}

  /**
   * Handle form submission (override in subclass).
   * @param {Event} e
   */
  async handleSubmit(e) {
    e.preventDefault();
  }

  /**
   * Handle keydown events.
   * @param {KeyboardEvent} e
   */
  #handleKeydown(e) {
    if (e.key === 'Escape') {
      this.close();
    }
  }

  /**
   * Handle backdrop click.
   * @param {MouseEvent} e
   */
  #handleBackdropClick(e) {
    if (e.target.classList.contains('modal-backdrop')) {
      this.close();
    }
  }

  /**
   * Update error display.
   */
  #updateError() {
    let errorEl = this.querySelector('.modal-error');
    if (errorEl) {
      errorEl.textContent = this.#error;
      errorEl.style.display = this.#error ? 'block' : 'none';
    }
  }

  /**
   * Get modal content (override in subclass).
   * @returns {string}
   */
  getContent() {
    return '';
  }

  /**
   * Render the modal.
   */
  render() {
    this.innerHTML = `
      <div class="modal-backdrop" onclick="this.closest('hero-modal, hero-modal-session, hero-modal-agent, hero-modal-ability').close()">
        <div class="modal-content" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h2>${escapeHtml(this.modalTitle)}</h2>
            <button class="modal-close" onclick="this.closest('hero-modal, hero-modal-session, hero-modal-agent, hero-modal-ability').close()">×</button>
          </div>
          <div class="modal-body">
            ${this.getContent()}
          </div>
          <div class="modal-error" style="display: ${this.#error ? 'block' : 'none'}">
            ${escapeHtml(this.#error)}
          </div>
        </div>
      </div>
    `;

    // Attach form handler
    let form = this.querySelector('form');
    if (form) {
      form.addEventListener('submit', (e) => this.handleSubmit(e));
    }
  }
}

// ============================================================================
// HeroModalSession - New Session Modal
// ============================================================================

export class HeroModalSession extends HeroModal {
  static tagName = 'hero-modal-session';

  get modalName() { return 'new-session'; }
  get modalTitle() { return 'New Session'; }

  onOpen() {
    // Refresh agents list
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
      <form>
        <div class="form-group">
          <label for="session-name">Session Name *</label>
          <input type="text" id="session-name" name="name" required placeholder="My Chat">
        </div>
        <div class="form-group">
          <label for="session-agent">Agent *</label>
          <select id="session-agent" name="agentId" required>
            ${agentOptions}
          </select>
        </div>
        <div class="form-group">
          <label for="session-prompt">System Prompt (optional)</label>
          <textarea id="session-prompt" name="systemPrompt" rows="4" placeholder="Custom instructions..."></textarea>
        </div>
        <div class="form-actions">
          <button type="button" onclick="this.closest('hero-modal-session').close()">Cancel</button>
          <button type="submit" class="primary">Create Session</button>
        </div>
      </form>
    `;
  }

  async handleSubmit(e) {
    e.preventDefault();

    let form = e.target;
    let name = form.querySelector('[name="name"]').value.trim();
    let agentId = parseInt(form.querySelector('[name="agentId"]').value, 10);
    let systemPrompt = form.querySelector('[name="systemPrompt"]').value.trim() || null;

    if (!name || !agentId) {
      this.error = 'Please fill in all required fields';
      return;
    }

    try {
      let { createSession } = await import('../api.js');
      let session = await createSession(name, agentId, systemPrompt);

      this.close();

      this.dispatchEvent(new CustomEvent('navigate', {
        detail: { path: `/sessions/${session.id}` },
        bubbles: true,
      }));
    } catch (error) {
      this.error = error.message;
    }
  }
}

// ============================================================================
// HeroModalAgent - New/Edit Agent Modal
// ============================================================================

export class HeroModalAgent extends HeroModal {
  static tagName = 'hero-modal-agent';

  get modalName() { return 'new-agent'; }
  get modalTitle() { return 'New Agent'; }

  getContent() {
    let abilities = GlobalState.abilities.valueOf() || { system: [], user: [] };
    let allAbilities = [...(abilities.system || []), ...(abilities.user || [])];

    let abilitiesHtml = allAbilities.map((a) => `
      <label class="checkbox-item">
        <input type="checkbox" name="abilities" value="${escapeHtml(a.name)}">
        ${escapeHtml(a.name)}
      </label>
    `).join('');

    return `
      <form>
        <div class="form-group">
          <label for="agent-name">Name *</label>
          <input type="text" id="agent-name" name="name" required placeholder="Claude Assistant">
        </div>
        <div class="form-group">
          <label for="agent-type">Type *</label>
          <select id="agent-type" name="type" required onchange="this.closest('hero-modal-agent').filterModels()">
            <option value="claude">Claude (Anthropic)</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        <div class="form-group">
          <label for="agent-model">Model</label>
          <select id="agent-model" name="model">
            <option value="">Default</option>
            <optgroup label="Claude Models" id="claude-models">
              <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
              <option value="claude-opus-4-20250514">Claude Opus 4</option>
            </optgroup>
            <optgroup label="OpenAI Models" id="openai-models" style="display:none">
              <option value="gpt-4o">GPT-4o</option>
              <option value="gpt-4-turbo">GPT-4 Turbo</option>
            </optgroup>
          </select>
        </div>
        <div class="form-group">
          <label for="agent-api-key">API Key *</label>
          <input type="password" id="agent-api-key" name="apiKey" required placeholder="sk-...">
        </div>
        <div class="form-group">
          <label for="agent-api-url">API URL (optional)</label>
          <input type="url" id="agent-api-url" name="apiUrl" placeholder="https://api.anthropic.com">
        </div>
        <div class="form-group">
          <label>Default Abilities</label>
          <div class="checkbox-list">
            ${abilitiesHtml || '<em>No abilities available</em>'}
          </div>
        </div>
        <div class="form-actions">
          <button type="button" onclick="this.closest('hero-modal-agent').close()">Cancel</button>
          <button type="submit" class="primary">Create Agent</button>
        </div>
      </form>
    `;
  }

  filterModels() {
    let type = this.querySelector('[name="type"]').value;
    let claudeGroup = this.querySelector('#claude-models');
    let openaiGroup = this.querySelector('#openai-models');

    if (claudeGroup) claudeGroup.style.display = (type === 'claude') ? '' : 'none';
    if (openaiGroup) openaiGroup.style.display = (type === 'openai') ? '' : 'none';
  }

  async handleSubmit(e) {
    e.preventDefault();

    let form = e.target;
    let name = form.querySelector('[name="name"]').value.trim();
    let type = form.querySelector('[name="type"]').value;
    let model = form.querySelector('[name="model"]').value;
    let apiKey = form.querySelector('[name="apiKey"]').value;
    let apiUrl = form.querySelector('[name="apiUrl"]').value.trim() || null;

    let abilities = Array.from(form.querySelectorAll('[name="abilities"]:checked'))
      .map((cb) => cb.value);

    if (!name || !type || !apiKey) {
      this.error = 'Please fill in all required fields';
      return;
    }

    let config = {};
    if (model) config.model = model;

    try {
      let { createAgent, fetchAgents } = await import('../api.js');
      await createAgent(name, type, apiKey, apiUrl, abilities, config);

      // Refresh agents
      let agents = await fetchAgents();
      this.setGlobal('agents', agents);

      this.close();

      // Show new session modal
      this.dispatchEvent(new CustomEvent('show-modal', {
        detail: { modal: 'new-session' },
        bubbles: true,
      }));
    } catch (error) {
      this.error = error.message;
    }
  }
}

// ============================================================================
// HeroModalAbility - Ability Editor Modal
// ============================================================================

export class HeroModalAbility extends HeroModal {
  static tagName = 'hero-modal-ability';

  #editId = null;

  get modalName() { return 'ability'; }
  get modalTitle() { return this.#editId ? 'Edit Ability' : 'New Ability'; }

  /**
   * Open for editing.
   * @param {number} abilityId
   */
  openEdit(abilityId) {
    this.#editId = abilityId;
    this.open();
  }

  onOpen() {
    this.#editId = null;
  }

  getContent() {
    return `
      <form>
        <div class="form-group">
          <label for="ability-name">Name *</label>
          <input type="text" id="ability-name" name="name" required placeholder="my_tool">
        </div>
        <div class="form-group">
          <label for="ability-category">Category</label>
          <select id="ability-category" name="category">
            <option value="user">User</option>
            <option value="system">System</option>
          </select>
        </div>
        <div class="form-group">
          <label for="ability-description">Description</label>
          <input type="text" id="ability-description" name="description" placeholder="What this ability does...">
        </div>
        <div class="form-group">
          <label for="ability-content">Content *</label>
          <textarea id="ability-content" name="content" rows="10" required placeholder="Ability instructions..."></textarea>
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" name="autoApprove"> Auto-approve
          </label>
        </div>
        <div class="form-actions">
          <button type="button" onclick="this.closest('hero-modal-ability').close()">Cancel</button>
          <button type="submit" class="primary">${this.#editId ? 'Save' : 'Create'}</button>
        </div>
      </form>
    `;
  }

  async handleSubmit(e) {
    e.preventDefault();

    let form = e.target;
    let name = form.querySelector('[name="name"]').value.trim();
    let category = form.querySelector('[name="category"]').value;
    let description = form.querySelector('[name="description"]').value.trim();
    let content = form.querySelector('[name="content"]').value;
    let autoApprove = form.querySelector('[name="autoApprove"]').checked;

    if (!name || !content) {
      this.error = 'Please fill in all required fields';
      return;
    }

    try {
      let { createAbility, updateAbility, fetchAbilities } = await import('../api.js');

      if (this.#editId) {
        await updateAbility(this.#editId, { name, category, description, content, autoApprove });
      } else {
        await createAbility({ name, category, description, content, autoApprove });
      }

      // Refresh abilities
      let abilities = await fetchAbilities();
      this.setGlobal('abilities', abilities);

      this.close();
    } catch (error) {
      this.error = error.message;
    }
  }
}

// Register the components
if (typeof customElements !== 'undefined') {
  customElements.define(HeroModal.tagName, HeroModal);
  customElements.define(HeroModalSession.tagName, HeroModalSession);
  customElements.define(HeroModalAgent.tagName, HeroModalAgent);
  customElements.define(HeroModalAbility.tagName, HeroModalAbility);
}
