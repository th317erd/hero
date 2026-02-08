'use strict';

// ============================================================================
// State
// ============================================================================

const state = {
  user:                 null,
  sessions:             [],
  agents:               [],
  abilities:            { system: [], user: [] },
  currentSession:       null,
  messages:             [],
  isLoading:            false,
  runningOperations:    [],
  editingAbilityId:     null,
  ws:                   null,
  assertions:           {},    // Map of messageId -> [assertion, ...]
  pendingQuestions:     {},    // Map of assertionId -> { resolve, timeout }
  activeDemandQuestion: null,  // { messageId, assertionId } for current demand question
  showHidden:           false, // Toggle for showing archived/agent sessions
  showHiddenMessages:   false, // Toggle for showing hidden messages in chat
  pendingApprovals:     {},    // Map of executionId -> approval request data
  pendingAbilityQs:     {},    // Map of questionId -> ability question data
  searchQuery:          '',    // Search query for sessions
  messageQueue:         [],    // Queued messages while agent is busy
  streamingMode:        true,  // Use streaming mode for agent responses
  streamingMessage:     null,  // Current streaming message state { id, content, elements }
  globalSpend:          { cost: 0 },  // Total spend across all agents
  serviceSpend:         { cost: 0 },  // Spend for agents with same API key
  sessionSpend:         { cost: 0 },  // Spend for current session
};

// ============================================================================
// DOM Elements
// ============================================================================

const elements = {
  // Views
  loginView:    document.getElementById('login-view'),
  sessionsView: document.getElementById('sessions-view'),
  chatView:     document.getElementById('chat-view'),

  // Login
  loginForm:   document.getElementById('login-form'),
  loginError:  document.getElementById('login-error'),

  // Sessions
  sessionsList:    document.getElementById('sessions-list'),
  sessionSearch:   document.getElementById('session-search'),
  toggleArchived:  document.getElementById('toggle-archived'),
  newSessionButton:   document.getElementById('new-session-button'),
  logoutButton:       document.getElementById('logout-button'),

  // Chat
  sessionTitle:       document.getElementById('session-title'),
  sessionSelect:      document.getElementById('session-select'),
  messagesContainer:  document.getElementById('chat'),  // hero-chat component
  heroChat:           document.getElementById('chat'),  // hero-chat component reference
  messageInput:       document.getElementById('message-input'),
  sendButton:            document.getElementById('send-button'),
  clearButton:           document.getElementById('clear-button'),
  backButton:            document.getElementById('back-button'),
  chatLogoutButton:      document.getElementById('chat-logout-button'),
  showHiddenToggle:   document.getElementById('show-hidden-toggle'),
  scrollToBottomBtn:  document.getElementById('scroll-to-bottom'),
  chatMain:           document.querySelector('.chat-main'),

  // New Session Modal
  newSessionModal:  document.getElementById('new-session-modal'),
  newSessionForm:   document.getElementById('new-session-form'),
  agentSelect:      document.getElementById('agent-select'),
  newSessionError:  document.getElementById('new-session-error'),
  cancelNewSession: document.getElementById('cancel-new-session'),

  // New Agent Modal
  newAgentModal:        document.getElementById('new-agent-modal'),
  newAgentForm:         document.getElementById('new-agent-form'),
  newAgentError:        document.getElementById('new-agent-error'),
  cancelNewAgent:       document.getElementById('cancel-new-agent'),
  agentAbilitiesList:   document.getElementById('agent-abilities-list'),

  // Abilities
  abilitiesButton:         document.getElementById('abilities-button'),
  abilitiesModal:       document.getElementById('abilities-modal'),
  closeAbilitiesModal:  document.getElementById('close-abilities-modal'),
  systemAbilitiesList:  document.getElementById('system-abilities-list'),
  userAbilitiesList:    document.getElementById('user-abilities-list'),
  newAbilityButton:        document.getElementById('new-ability-button'),

  // Edit Ability Modal
  editAbilityModal:     document.getElementById('edit-ability-modal'),
  editAbilityTitle:     document.getElementById('edit-ability-title'),
  editAbilityForm:      document.getElementById('edit-ability-form'),
  editAbilityError:     document.getElementById('edit-ability-error'),
  cancelEditAbility:    document.getElementById('cancel-edit-ability'),

  // Operations Panel
  operationsPanel:      document.getElementById('operations-panel'),
  operationsList:       document.getElementById('operations-list'),
  toggleOperations:     document.getElementById('toggle-operations'),

  // Agents
  agentsButton:            document.getElementById('agents-button'),
  agentsModal:          document.getElementById('agents-modal'),
  closeAgentsModal:     document.getElementById('close-agents-modal'),
  addAgentFromList:     document.getElementById('add-agent-from-list'),
  agentsList:           document.getElementById('agents-list'),

  // Agent Config Modal
  agentConfigModal:     document.getElementById('agent-config-modal'),
  agentConfigForm:      document.getElementById('agent-config-form'),
  agentConfigId:        document.getElementById('agent-config-id'),
  agentConfigJson:      document.getElementById('agent-config-json'),
  agentConfigError:     document.getElementById('agent-config-error'),
  cancelAgentConfig:    document.getElementById('cancel-agent-config'),

  // Ability Modal
  abilityModal:         document.getElementById('ability-modal'),
  abilityModalTitle:    document.getElementById('ability-modal-title'),
  abilityForm:          document.getElementById('ability-form'),
  abilityEditId:        document.getElementById('ability-edit-id'),
  abilityName:          document.getElementById('ability-name'),
  abilityCategory:      document.getElementById('ability-category'),
  abilityDescription:   document.getElementById('ability-description'),
  abilityContent:       document.getElementById('ability-content'),
  abilityAutoApprove:   document.getElementById('ability-auto-approve'),
  abilityDangerLevel:   document.getElementById('ability-danger-level'),
  abilityModalError:    document.getElementById('ability-modal-error'),
  cancelAbilityModal:   document.getElementById('cancel-ability-modal'),
};

// Read base path from <base> tag (set by server from package.json config)
const BASE_PATH = document.querySelector('base')?.getAttribute('href')?.replace(/\/$/, '') || '';
