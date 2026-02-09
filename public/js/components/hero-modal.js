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

  // Error state (using underscore instead of # for inheritance compatibility)
  _errorMessage = '';

  /**
   * Get current error message.
   * @returns {string}
   */
  get error() {
    return this._errorMessage;
  }

  /**
   * Set error message.
   * @param {string} message
   */
  set error(message) {
    this._errorMessage = message;
    this._updateError();
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
   * Get the dialog element.
   * Returns the dialog whether it's in the component or moved to body.
   */
  get $dialog() {
    // First check if we have a reference
    if (this._dialog)
      return this._dialog;

    // Look for dialog in component
    let dialog = this.querySelector('dialog');
    if (dialog)
      return dialog;

    // Look for our dialog in body (by modal name)
    return document.querySelector(`body > dialog[data-modal-name="${this.modalName}"]`);
  }

  /**
   * Component mounted.
   */
  mounted() {
    // Listen for show-modal events
    document.addEventListener('show-modal', (event) => {
      if (event.detail.modal === this.modalName) {
        this.openModal();
      }
    });
  }

  /**
   * Component unmounted - clean up dialog from body.
   */
  unmounted() {
    let dialog = document.querySelector(`body > dialog[data-modal-name="${this.modalName}"]`);
    if (dialog)
      dialog.remove();
  }

  /**
   * Open the modal.
   */
  async openModal() {
    this._errorMessage = '';

    // Allow onOpen to cancel opening (returns false)
    let onOpenResult = this.onOpen();
    if (onOpenResult instanceof Promise) {
      onOpenResult = await onOpenResult;
    }
    if (onOpenResult === false)
      return;

    // Get or prepare the dialog
    let dialog = this._prepareDialog();
    if (!dialog)
      return;

    // Show the component container
    this.style.display = '';

    // Ensure dialog is closed before opening as modal
    if (dialog.open)
      dialog.close();

    // Open as modal
    dialog.showModal();

    // Focus first input
    requestAnimationFrame(() => {
      let firstInput = dialog.querySelector('input, select, textarea');
      if (firstInput)
        firstInput.focus();
    });
  }

  /**
   * Prepare the dialog for display.
   * Moves it to body if needed and binds event handlers.
   */
  _prepareDialog() {
    // Check if dialog already in body
    let dialog = document.querySelector(`body > dialog[data-modal-name="${this.modalName}"]`);
    if (dialog) {
      this._dialog = dialog;
      // Ensure it's closed (in case it was left open non-modally)
      if (dialog.open)
        dialog.close();
      return dialog;
    }

    // Find dialog in component
    dialog = this.querySelector('dialog');
    if (!dialog)
      return null;

    // Close if open (prevents "already open as non-modal" error)
    if (dialog.open)
      dialog.close();

    // Mark the dialog with our modal name
    dialog.setAttribute('data-modal-name', this.modalName);

    // Move to body for proper rendering
    document.body.appendChild(dialog);
    this._dialog = dialog;

    // Bind event handlers (only once)
    this._bindDialogEvents(dialog);

    return dialog;
  }

  /**
   * Bind event handlers to the dialog.
   */
  _bindDialogEvents(dialog) {
    let self = this;

    // Bind form submit
    let form = dialog.querySelector('form');
    if (form) {
      form.onsubmit = (event) => self.handleSubmit(event);
    }

    // Bind footer buttons (Cancel buttons) using onclick for reliability
    let footer = dialog.querySelector('footer[slot="footer"], footer');
    if (footer) {
      let buttons = footer.querySelectorAll('button[type="button"]');
      for (let button of buttons) {
        button.onclick = () => dialog.close();
      }
    }

    // Handle backdrop click to close
    dialog.onclick = (event) => {
      if (event.target === dialog)
        dialog.close();
    };

    // Handle close event
    dialog.onclose = () => {
      self.onClose();
    };
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
  _updateError() {
    let dialog = this.$dialog;
    let errorElement = dialog?.querySelector('.error-message');
    if (errorElement) {
      errorElement.textContent = this._errorMsg;
      errorElement.style.display = (this._errorMsg) ? 'block' : 'none';
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
   * Returns the dialog structure with content from getContent().
   */
  static get template() {
    return null; // Built dynamically in connectedCallback via innerHTML
  }

  /**
   * Build and set the component's innerHTML.
   * Called by subclasses in mounted().
   */
  buildContent() {
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
    this.buildContent();
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
      <form autocomplete="off">
        <div class="form-row">
          <div class="form-group form-group-half">
            <label for="agent-name">Agent Name</label>
            <input type="text" id="agent-name" name="name" required placeholder="e.g., My Claude" autocomplete="off">
          </div>
          <div class="form-group form-group-half">
            <label for="agent-type">Base Type</label>
            <select id="agent-type" name="type" required data-event-onchange="filterModels">
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
            <input type="url" id="agent-api-url" name="apiUrl" placeholder="Custom endpoint..." autocomplete="off">
          </div>
        </div>
        <div class="form-group">
          <label for="agent-api-key">API Key</label>
          <input type="password" id="agent-api-key" name="apiKey" required placeholder="sk-..." autocomplete="off">
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
    let type = this._dialog?.querySelector('[name="type"]')?.value;
    let claudeGroup = this._dialog?.querySelector('#claude-models');
    let openaiGroup = this._dialog?.querySelector('#openai-models');

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
    this.buildContent();
    super.mounted();
  }
}

// ============================================================================
// HeroModalAbility - Ability Editor Modal
// ============================================================================

export class HeroModalAbility extends HeroModal {
  static tagName = 'hero-modal-ability';

  _editId = null;

  get modalName() { return 'ability'; }
  get modalTitle() { return (this._editId) ? 'Edit Ability' : 'New Ability'; }

  /**
   * Open for editing.
   * @param {number} abilityId
   */
  openEdit(abilityId) {
    this._editId = abilityId;
    this.openModal();
  }

  onOpen() {
    this._editId = null;
  }

  getContent() {
    return `
      <form autocomplete="off">
        <div class="form-row">
          <div class="form-group form-group-half">
            <label for="ability-name">Name</label>
            <input type="text" id="ability-name" name="name" required pattern="[a-z][a-z0-9_]*" placeholder="my_ability" autocomplete="off">
            <small class="form-hint">Lowercase letters, numbers, underscores only.</small>
          </div>
          <div class="form-group form-group-half">
            <label for="ability-category">Category</label>
            <input type="text" id="ability-category" name="category" placeholder="custom" autocomplete="off">
          </div>
        </div>
        <div class="form-group">
          <label for="ability-description">Description</label>
          <input type="text" id="ability-description" name="description" placeholder="Brief description of this ability" autocomplete="off">
        </div>
        <div class="form-group">
          <label for="ability-applies">When to Use</label>
          <input type="text" id="ability-applies" name="applies" placeholder="e.g., when user asks about coding, for file operations, always" autocomplete="off">
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
          <button type="submit" class="button button-primary">${(this._editId) ? 'Save' : 'Create'}</button>
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

      if (this._editId) {
        await updateAbility(this._editId, data);
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
    this.buildContent();
    super.mounted();
  }
}

// ============================================================================
// HeroModalAbilities - Abilities List Modal
// ============================================================================

export class HeroModalAbilities extends HeroModal {
  static tagName = 'hero-modal-abilities';

  _activeTab = 'system';

  get modalName() { return 'abilities'; }
  get modalTitle() { return 'Abilities'; }

  async onOpen() {
    // Fetch fresh abilities list
    try {
      let abilities = await API.abilities.list();
      this.setGlobal('abilities', abilities);
    } catch (error) {
      console.error('Failed to fetch abilities:', error);
    }

    // Rebuild content to refresh lists
    this.buildContent();
    this._prepareDialog();
    this._bindTabEvents();
    return true;
  }

  _bindTabEvents() {
    let dialog = this.$dialog;
    if (!dialog) return;

    // Tab buttons
    let tabButtons = dialog.querySelectorAll('.tab-button');
    for (let button of tabButtons) {
      button.onclick = () => this._switchTab(button.dataset.tab);
    }

    // New ability button
    let newBtn = dialog.querySelector('.new-ability-button');
    if (newBtn) {
      newBtn.onclick = () => {
        this.close();
        document.dispatchEvent(new CustomEvent('show-modal', {
          detail: { modal: 'ability' },
        }));
      };
    }

    // Edit buttons
    let editBtns = dialog.querySelectorAll('.edit-ability-btn');
    for (let btn of editBtns) {
      btn.onclick = () => this._editAbility(parseInt(btn.dataset.id, 10));
    }

    // Delete buttons
    let deleteBtns = dialog.querySelectorAll('.delete-ability-btn');
    for (let btn of deleteBtns) {
      btn.onclick = () => this._deleteAbility(parseInt(btn.dataset.id, 10));
    }
  }

  _switchTab(tab) {
    this._activeTab = tab;
    let dialog = this.$dialog;
    if (!dialog) return;

    // Update tab buttons
    let tabButtons = dialog.querySelectorAll('.tab-button');
    for (let button of tabButtons) {
      button.classList.toggle('active', button.dataset.tab === tab);
    }

    // Update tab content
    let systemTab = dialog.querySelector('#abilities-tab-system');
    let userTab = dialog.querySelector('#abilities-tab-user');
    if (systemTab) systemTab.classList.toggle('active', tab === 'system');
    if (userTab) userTab.classList.toggle('active', tab === 'user');
  }

  async _editAbility(id) {
    this.close();
    // Find and open ability modal with edit ID
    let abilityModal = document.querySelector('hero-modal-ability');
    if (abilityModal) {
      abilityModal._editId = id;
      // Load ability data into form
      let abilities = GlobalState.abilities.valueOf() || { system: [], user: [] };
      let ability = abilities.user?.find((a) => a.id === id);
      if (ability) {
        abilityModal.openModal();
        // Fill form after dialog opens
        requestAnimationFrame(() => {
          let dialog = abilityModal.$dialog;
          if (dialog) {
            let form = dialog.querySelector('form');
            if (form) {
              form.querySelector('[name="name"]').value = ability.name || '';
              form.querySelector('[name="category"]').value = ability.category || '';
              form.querySelector('[name="description"]').value = ability.description || '';
              form.querySelector('[name="applies"]').value = ability.applies || '';
              form.querySelector('[name="content"]').value = ability.content || '';
              form.querySelector('[name="autoApprove"]').checked = ability.autoApprove || false;
              form.querySelector('[name="dangerLevel"]').value = ability.dangerLevel || 'safe';
            }
          }
        });
      }
    }
  }

  async _deleteAbility(id) {
    if (!confirm('Are you sure you want to delete this ability?')) return;

    try {
      let { deleteAbility, fetchAbilities } = await import('../api.js');
      await deleteAbility(id);
      let abilities = await fetchAbilities();
      this.setGlobal('abilities', abilities);
      // Refresh dialog content
      this.buildContent();
      this._prepareDialog();
      this._bindTabEvents();
    } catch (error) {
      alert('Failed to delete ability: ' + error.message);
    }
  }

  getContent() {
    let abilities = GlobalState.abilities.valueOf() || { system: [], user: [] };
    let systemAbilities = abilities.system || [];
    let userAbilities = abilities.user || [];

    let systemList = (systemAbilities.length === 0)
      ? '<p class="empty-state">No system abilities loaded.</p>'
      : systemAbilities.map((a) => `
          <div class="ability-item">
            <div class="ability-info">
              <strong>${escapeHtml(a.name)}</strong>
              <span class="ability-category">${escapeHtml(a.category || 'system')}</span>
            </div>
            <p class="ability-description">${escapeHtml(a.description || '')}</p>
          </div>
        `).join('');

    let userList = (userAbilities.length === 0)
      ? '<p class="empty-state">No custom abilities yet. Click "New Ability" to create one.</p>'
      : userAbilities.map((a) => `
          <div class="ability-item">
            <div class="ability-info">
              <strong>${escapeHtml(a.name)}</strong>
              <span class="ability-category">${escapeHtml(a.category || 'custom')}</span>
              <div class="ability-actions">
                <button type="button" class="button button-sm edit-ability-btn" data-id="${a.id}">Edit</button>
                <button type="button" class="button button-sm button-danger delete-ability-btn" data-id="${a.id}">Delete</button>
              </div>
            </div>
            <p class="ability-description">${escapeHtml(a.description || '')}</p>
          </div>
        `).join('');

    return `
      <div class="modal-header-tabs">
        <div class="modal-tabs">
          <button type="button" class="tab-button active" data-tab="system">System</button>
          <button type="button" class="tab-button" data-tab="user">My Abilities</button>
        </div>
      </div>
      <div id="abilities-tab-system" class="tab-content active">
        <div class="abilities-list">${systemList}</div>
      </div>
      <div id="abilities-tab-user" class="tab-content">
        <div class="abilities-actions">
          <button type="button" class="button button-primary new-ability-button">New Ability</button>
        </div>
        <div class="abilities-list">${userList}</div>
      </div>
      <footer slot="footer">
        <button type="button" class="button button-secondary">Close</button>
      </footer>
    `;
  }

  mounted() {
    this.buildContent();
    super.mounted();
  }
}

// ============================================================================
// HeroModalAgents - Agents List Modal
// ============================================================================

export class HeroModalAgents extends HeroModal {
  static tagName = 'hero-modal-agents';

  get modalName() { return 'agents'; }
  get modalTitle() { return 'Agents'; }

  async onOpen() {
    // Fetch fresh agents list
    try {
      let agents = await API.agents.list();
      this.setGlobal('agents', agents);
    } catch (error) {
      console.error('Failed to fetch agents:', error);
    }

    // Rebuild content to refresh list
    this.buildContent();
    this._prepareDialog();
    this._bindAgentEvents();
    return true;
  }

  _bindAgentEvents() {
    let dialog = this.$dialog;
    if (!dialog) return;

    // Add agent button
    let addBtn = dialog.querySelector('.add-agent-button');
    if (addBtn) {
      addBtn.onclick = () => {
        this.close();
        document.dispatchEvent(new CustomEvent('show-modal', {
          detail: { modal: 'new-agent' },
        }));
      };
    }

    // Config buttons
    let configBtns = dialog.querySelectorAll('.config-agent-btn');
    for (let btn of configBtns) {
      btn.onclick = () => this._openConfig(parseInt(btn.dataset.id, 10));
    }

    // Delete buttons
    let deleteBtns = dialog.querySelectorAll('.delete-agent-btn');
    for (let btn of deleteBtns) {
      btn.onclick = () => this._deleteAgent(parseInt(btn.dataset.id, 10));
    }
  }

  _openConfig(agentId) {
    this.close();
    // Find agent config modal and open with agent ID
    let configModal = document.querySelector('hero-modal-agent-config');
    if (configModal) {
      configModal._agentId = agentId;
      configModal.openModal();
    }
  }

  async _deleteAgent(id) {
    if (!confirm('Are you sure you want to delete this agent?')) return;

    try {
      let { deleteAgent, fetchAgents } = await import('../api.js');
      await deleteAgent(id);
      let agents = await fetchAgents();
      this.setGlobal('agents', agents);
      // Refresh dialog content
      this.buildContent();
      this._prepareDialog();
      this._bindAgentEvents();
    } catch (error) {
      alert('Failed to delete agent: ' + error.message);
    }
  }

  getContent() {
    let agents = GlobalState.agents.valueOf() || [];

    let agentsList = (agents.length === 0)
      ? '<p class="empty-state">No agents configured. Click "Add Agent" to create one.</p>'
      : agents.map((a) => `
          <div class="agent-item">
            <div class="agent-info">
              <strong>${escapeHtml(a.name)}</strong>
              <span class="agent-type">${escapeHtml(a.type)}</span>
              ${a.model ? `<span class="agent-model">${escapeHtml(a.model)}</span>` : ''}
            </div>
            <div class="agent-actions">
              <button type="button" class="button button-sm config-agent-btn" data-id="${a.id}">Config</button>
              <button type="button" class="button button-sm button-danger delete-agent-btn" data-id="${a.id}">Delete</button>
            </div>
          </div>
        `).join('');

    return `
      <div class="agents-content">
        <div class="agents-actions">
          <button type="button" class="button button-primary add-agent-button">Add Agent</button>
        </div>
        <div class="agents-list">${agentsList}</div>
      </div>
      <footer slot="footer">
        <button type="button" class="button button-secondary">Close</button>
      </footer>
    `;
  }

  mounted() {
    this.buildContent();
    super.mounted();
  }
}

// ============================================================================
// HeroModalAgentConfig - Agent Configuration Modal
// ============================================================================

export class HeroModalAgentConfig extends HeroModal {
  static tagName = 'hero-modal-agent-config';

  _agentId = null;

  get modalName() { return 'agent-config'; }
  get modalTitle() { return 'Agent Configuration'; }

  onOpen() {
    if (!this._agentId) return false;
    this.buildContent();
    this._prepareDialog();
    this._loadAgentConfig();
    return true;
  }

  _loadAgentConfig() {
    let agents = GlobalState.agents.valueOf() || [];
    let agent = agents.find((a) => a.id === this._agentId);
    if (!agent) return;

    let dialog = this.$dialog;
    if (!dialog) return;

    let configJson = dialog.querySelector('[name="config"]');
    if (configJson) {
      configJson.value = JSON.stringify(agent.config || {}, null, 2);
    }
  }

  getContent() {
    return `
      <form autocomplete="off">
        <p class="config-description">
          This JSON is merged into every API call for this agent.
          Common fields: model, maxTokens, temperature, etc.
        </p>
        <div class="form-group">
          <label for="agent-config-json">Configuration (JSON)</label>
          <textarea id="agent-config-json" name="config" rows="15" class="config-editor" autocomplete="off"
            placeholder='{ "model": "claude-sonnet-4-20250514", "maxTokens": 4096 }'></textarea>
        </div>
        <footer slot="footer">
          <button type="button" class="button button-secondary">Cancel</button>
          <button type="submit" class="button button-primary">Save</button>
        </footer>
      </form>
    `;
  }

  async handleSubmit(event) {
    event.preventDefault();

    let form = event.target;
    let configStr = form.querySelector('[name="config"]').value.trim();

    let config;
    try {
      config = configStr ? JSON.parse(configStr) : {};
    } catch (e) {
      this.error = 'Invalid JSON: ' + e.message;
      return;
    }

    try {
      let { updateAgentConfig, fetchAgents } = await import('../api.js');
      await updateAgentConfig(this._agentId, config);

      let agents = await fetchAgents();
      this.setGlobal('agents', agents);

      this.close();
    } catch (error) {
      this.error = error.message;
    }
  }

  mounted() {
    this.buildContent();
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
  customElements.define(HeroModalAbilities.tagName, HeroModalAbilities);
  customElements.define(HeroModalAgents.tagName, HeroModalAgents);
  customElements.define(HeroModalAgentConfig.tagName, HeroModalAgentConfig);
}
