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

  // Operations Panel
  operationsPanel:      document.getElementById('operations-panel'),
  operationsList:       document.getElementById('operations-list'),
  toggleOperations:     document.getElementById('toggle-operations'),
};

// Read base path from <base> tag (set by server from package.json config)
const BASE_PATH = document.querySelector('base')?.getAttribute('href')?.replace(/\/$/, '') || '';
