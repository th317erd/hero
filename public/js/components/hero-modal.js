'use strict';

/**
 * Hero Modal - Base Modal Component
 *
 * Extends MythixUIModal to leverage:
 * - Native <dialog> element
 * - Auto-bound footer buttons via slots (close on click)
 * - Escape key handling (native)
 * - Backdrop click to close (autoclose attribute)
 */

import { MythixUIModal } from '@cdn/mythix-ui-modal@1';
import { GlobalState, DynamicProperty } from './hero-base.js';

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

export class HeroModal extends MythixUIModal {
  static tagName = 'hero-modal';

  // Error state
  #error = '';

  /**
   * Get current error message.
   * @returns {string}
   */
  get error() {
    return this.#error;
  }

  /**
   * Set error message.
   * @param {string} message
   */
  set error(message) {
    this.#error = message;
    this.#updateError();
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
   * Component mounted.
   */
  mounted() {
    super.mounted();

    // Listen for show-modal events
    document.addEventListener('show-modal', (event) => {
      if (event.detail.modal === this.modalName) {
        this.openModal();
      }
    });

    // Listen for close event to call onClose hook
    this.$dialog.addEventListener('close', () => {
      this.onClose();
      // Hide component container when dialog closes
      this.style.display = 'none';
    });

    // Attach form submit handler
    let form = this.querySelector('form');
    if (form) {
      form.addEventListener('submit', (event) => this.handleSubmit(event));
    }
  }

  /**
   * Open the modal.
   */
  openModal() {
    this.#error = '';
    this.#updateError();

    // Allow onOpen to cancel opening (returns false)
    if (this.onOpen() === false)
      return;

    // Show the component container
    this.style.display = '';

    this.showModal();

    // Focus first input
    requestAnimationFrame(() => {
      let firstInput = this.querySelector('input, select, textarea');
      if (firstInput)
        firstInput.focus();
    });
  }

  /**
   * Hook called when modal opens (override in subclass).
   * Return false to cancel opening.
   */
  onOpen() {}

  /**
   * Hook called when modal closes (override in subclass).
   */
  onClose() {}

  /**
   * Handle form submission (override in subclass).
   * @param {Event} event
   */
  async handleSubmit(event) {
    event.preventDefault();
  }

  /**
   * Update error display.
   */
  #updateError() {
    let errorElement = this.querySelector('.error-message');
    if (errorElement) {
      errorElement.textContent = this.#error;
      errorElement.style.display = (this.#error) ? 'block' : 'none';
    }
  }

  /**
   * Convenience method to update a global state property.
   * @param {string} key - GlobalState key
   * @param {*} value - New value
   */
  setGlobal(key, value) {
    if (GlobalState[key]) {
      GlobalState[key][DynamicProperty.set](value);
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
   * Build the template.
   * Subclasses override getContent() to provide form content.
   */
  static get template() {
    return null; // Template built dynamically in render()
  }

  /**
   * Render the modal content.
   * Called by subclasses after construction.
   */
  render() {
    this.innerHTML = `
      <dialog autoclose>
        <header>
          <h3>${escapeHtml(this.modalTitle)}</h3>
        </header>
        <main>
          ${this.getContent()}
          <div class="error-message" style="display: none;"></div>
        </main>
      </dialog>
    `;

    // Re-attach form handler after render
    let form = this.querySelector('form');
    if (form) {
      form.addEventListener('submit', (event) => this.handleSubmit(event));
    }

    // Trigger slot change handlers to bind footer buttons
    this.onFooterSlotChange();
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
    // If no agents, redirect to new-agent modal
    let agents = GlobalState.agents.valueOf() || [];
    if (agents.length === 0) {
      document.dispatchEvent(new CustomEvent('show-modal', {
        detail: { modal: 'new-agent' },
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
      <form>
        <div class="form-group">
          <label for="session-name">Session Name</label>
          <input type="text" id="session-name" name="name" required placeholder="e.g., project-x">
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
        <footer slot="footer">
          <button type="button" class="button button-secondary">Cancel</button>
          <button type="submit" class="button button-primary">Create</button>
        </footer>
      </form>
    `;
  }

  async handleSubmit(event) {
    event.preventDefault();

    let form = event.target;
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

  mounted() {
    this.render();
    super.mounted();
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

    let abilitiesHtml = allAbilities.map((ability) => `
      <label class="checkbox-item">
        <input type="checkbox" name="abilities" value="${escapeHtml(ability.name)}">
        ${escapeHtml(ability.name)}
      </label>
    `).join('');

    return `
      <form>
        <div class="form-row">
          <div class="form-group form-group-half">
            <label for="agent-name">Agent Name</label>
            <input type="text" id="agent-name" name="name" required placeholder="e.g., My Claude">
          </div>
          <div class="form-group form-group-half">
            <label for="agent-type">Base Type</label>
            <select id="agent-type" name="type" required onchange="this.closest('hero-modal-agent').filterModels()">
              <option value="claude">Claude (Anthropic)</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group form-group-half">
            <label for="agent-model">Model</label>
            <select id="agent-model" name="model">
              <option value="">Default</option>
              <optgroup label="Claude" id="claude-models">
                <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                <option value="claude-opus-4-20250514">Claude Opus 4</option>
                <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku</option>
              </optgroup>
              <optgroup label="OpenAI" id="openai-models" style="display:none">
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4-turbo">GPT-4 Turbo</option>
                <option value="gpt-4">GPT-4</option>
                <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
              </optgroup>
            </select>
          </div>
          <div class="form-group form-group-half">
            <label for="agent-api-url">API URL (optional)</label>
            <input type="url" id="agent-api-url" name="apiUrl" placeholder="Custom endpoint...">
          </div>
        </div>
        <div class="form-group">
          <label for="agent-api-key">API Key</label>
          <input type="password" id="agent-api-key" name="apiKey" required placeholder="sk-...">
        </div>
        <div class="form-group">
          <label>Default Abilities</label>
          <div id="agent-abilities-list" class="checkbox-list">
            ${abilitiesHtml || '<em>No abilities available</em>'}
          </div>
        </div>
        <footer slot="footer">
          <button type="button" class="button button-secondary">Cancel</button>
          <button type="submit" class="button button-primary">Add Agent</button>
        </footer>
      </form>
    `;
  }

  filterModels() {
    let type = this.querySelector('[name="type"]').value;
    let claudeGroup = this.querySelector('#claude-models');
    let openaiGroup = this.querySelector('#openai-models');

    if (claudeGroup)
      claudeGroup.style.display = (type === 'claude') ? '' : 'none';

    if (openaiGroup)
      openaiGroup.style.display = (type === 'openai') ? '' : 'none';
  }

  async handleSubmit(event) {
    event.preventDefault();

    let form = event.target;
    let name = form.querySelector('[name="name"]').value.trim();
    let type = form.querySelector('[name="type"]').value;
    let model = form.querySelector('[name="model"]').value;
    let apiKey = form.querySelector('[name="apiKey"]').value;
    let apiUrl = form.querySelector('[name="apiUrl"]').value.trim() || null;

    let abilities = Array.from(form.querySelectorAll('[name="abilities"]:checked'))
      .map((checkbox) => checkbox.value);

    if (!name || !type || !apiKey) {
      this.error = 'Please fill in all required fields';
      return;
    }

    let config = {};
    if (model)
      config.model = model;

    try {
      let { createAgent, fetchAgents } = await import('../api.js');
      await createAgent(name, type, apiKey, apiUrl, abilities, config);

      // Refresh agents
      let agents = await fetchAgents();
      this.setGlobal('agents', agents);

      this.close();

      // Show new session modal
      document.dispatchEvent(new CustomEvent('show-modal', {
        detail: { modal: 'new-session' },
      }));
    } catch (error) {
      this.error = error.message;
    }
  }

  mounted() {
    this.render();
    super.mounted();
  }
}

// ============================================================================
// HeroModalAbility - Ability Editor Modal
// ============================================================================

export class HeroModalAbility extends HeroModal {
  static tagName = 'hero-modal-ability';

  #editId = null;

  get modalName() { return 'ability'; }
  get modalTitle() { return (this.#editId) ? 'Edit Ability' : 'New Ability'; }

  /**
   * Open for editing.
   * @param {number} abilityId
   */
  openEdit(abilityId) {
    this.#editId = abilityId;
    this.openModal();
  }

  onOpen() {
    this.#editId = null;
  }

  getContent() {
    return `
      <form>
        <div class="form-row">
          <div class="form-group form-group-half">
            <label for="ability-name">Name</label>
            <input type="text" id="ability-name" name="name" required pattern="[a-z][a-z0-9_]*" placeholder="my_ability">
            <small class="form-hint">Lowercase letters, numbers, underscores only.</small>
          </div>
          <div class="form-group form-group-half">
            <label for="ability-category">Category</label>
            <input type="text" id="ability-category" name="category" placeholder="custom">
          </div>
        </div>
        <div class="form-group">
          <label for="ability-description">Description</label>
          <input type="text" id="ability-description" name="description" placeholder="Brief description of this ability">
        </div>
        <div class="form-group">
          <label for="ability-applies">When to Use</label>
          <input type="text" id="ability-applies" name="applies" placeholder="e.g., when user asks about coding, for file operations, always">
          <small class="form-hint">Describe the context or trigger for this ability (helps the agent know when to apply it)</small>
        </div>
        <div class="form-group">
          <label for="ability-content">Content (Markdown)</label>
          <textarea id="ability-content" name="content" required rows="12" placeholder="Instructions for the AI agent..."></textarea>
          <small class="form-hint">Template variables: {{DATE}}, {{TIME}}, {{USER_NAME}}, {{SESSION_NAME}}</small>
        </div>
        <div class="form-group">
          <label>Permissions</label>
          <div class="checkbox-list">
            <label class="checkbox-item">
              <input type="checkbox" id="ability-auto-approve" name="autoApprove">
              <span>Auto-approve (skip confirmation)</span>
            </label>
          </div>
          <select id="ability-danger-level" name="dangerLevel" class="form-select" style="margin-top: 8px;">
            <option value="safe">Safe - Low risk</option>
            <option value="moderate">Moderate - Some risk</option>
            <option value="dangerous">Dangerous - High risk</option>
          </select>
        </div>
        <footer slot="footer">
          <button type="button" class="button button-secondary">Cancel</button>
          <button type="submit" class="button button-primary">${(this.#editId) ? 'Save' : 'Create'}</button>
        </footer>
      </form>
    `;
  }

  async handleSubmit(event) {
    event.preventDefault();

    let form = event.target;
    let name = form.querySelector('[name="name"]').value.trim();
    let category = form.querySelector('[name="category"]').value.trim() || 'custom';
    let description = form.querySelector('[name="description"]').value.trim();
    let applies = form.querySelector('[name="applies"]').value.trim();
    let content = form.querySelector('[name="content"]').value;
    let autoApprove = form.querySelector('[name="autoApprove"]').checked;
    let dangerLevel = form.querySelector('[name="dangerLevel"]').value;

    if (!name || !content) {
      this.error = 'Please fill in all required fields';
      return;
    }

    try {
      let { createAbility, updateAbility, fetchAbilities } = await import('../api.js');

      let data = { name, category, description, applies, content, autoApprove, dangerLevel };

      if (this.#editId) {
        await updateAbility(this.#editId, data);
      } else {
        await createAbility(data);
      }

      // Refresh abilities
      let abilities = await fetchAbilities();
      this.setGlobal('abilities', abilities);

      this.close();
    } catch (error) {
      this.error = error.message;
    }
  }

  mounted() {
    this.render();
    super.mounted();
  }
}

// ============================================================================
// Register Components
// ============================================================================

if (typeof customElements !== 'undefined') {
  // Don't register HeroModal base class - it's abstract
  customElements.define(HeroModalSession.tagName, HeroModalSession);
  customElements.define(HeroModalAgent.tagName, HeroModalAgent);
  customElements.define(HeroModalAbility.tagName, HeroModalAbility);
}
