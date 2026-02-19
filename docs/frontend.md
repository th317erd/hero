# Frontend Design

The frontend is a vanilla HTML/CSS/JavaScript SPA with no framework dependencies. It provides an inbox-style sessions list and a chat interface with real-time streaming and HML rendering.

## URL Structure

| URL | View |
|-----|------|
| `/hero/` | Sessions inbox (home) |
| `/hero/sessions/{id}` | Chat view for specific session |
| `/hero/login` | Login page |

## Views

### Sessions Inbox (`/hero/`)

Inbox-style list with search and archive toggle:

```
┌─────────────────────────────────────────────────────────────────┐
│  Hero                      [Agents] [Processes] [New] [Logout]  │
├─────────────────────────────────────────────────────────────────┤
│  Your Sessions                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ [Search sessions...]                              [👁]  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ dev                              My Claude    2h ago 🗑  │   │
│  │ Last message preview here...                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ project-x                        GPT-4     yesterday 🗑  │   │
│  │ Working on the new feature...                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Features:
- **Search**: Filter sessions by name (real-time)
- **Archive toggle**: Eye icon shows/hides archived sessions
- **Archive button**: Red garbage can archives session
- **Alternating colors**: Odd/even row backgrounds
- **Relative dates**: "2h ago", "yesterday", "3 days ago"

### Chat View (`/hero/sessions/{id}`)

Full-screen chat with dynamic assertion rendering:

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Session Name              [Switch ▾] [Clear] [Logout]        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ You                                                      │   │
│  │ Search for hiking boots                                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Assistant                                                │   │
│  │                                                          │   │
│  │ ┌── command: web_search ─────────────────── running ─┐  │   │
│  │ │ Searching for "hiking boots"...                    │  │   │
│  │ │ Found 5 results                                    │  │   │
│  │ └────────────────────────────────────────────────────┘  │   │
│  │                                                          │   │
│  │ ┌── question (demand) ───────────────────────────────┐  │   │
│  │ │ Does this look right to you?                       │  │   │
│  │ │ [Yes] [No] [_______________]                       │  │   │
│  │ └────────────────────────────────────────────────────┘  │   │
│  │                                                          │   │
│  │ Here are the hiking boots I found...                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────┐  [Send]     │
│  │ Type a message...                              │              │
│  └───────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

## Fonts

- **UI**: System font stack (`-apple-system, BlinkMacSystemFont, ...`)
- **Messages**: Roboto Mono (`'Roboto Mono', monospace`)

The Roboto Mono font is loaded from Google Fonts for consistent code/message rendering.

## State Management

```javascript
const state = {
  currentSession: null,     // Current session ID
  sessions: [],             // List of sessions
  messages: [],             // Current session messages
  agents: [],               // User's agents
  processes: { system: [], user: [] },

  // UI state
  isLoading: false,
  showArchived: false,
  searchQuery: '',
  activeDemandQuestion: null,  // Currently active demand question
  messageQueue: [],            // Queued messages while agent is busy

  // Streaming state
  streamingMode: true,         // Use SSE streaming (default) or batch
  streamingMessage: null,      // Current streaming message { id, content, elements }
};
```

## Message Modes

Hero supports two message processing modes:

### Streaming Mode (Default)

Real-time SSE streaming with progressive HML parsing:

```javascript
async function processMessageStream(content) {
  state.streamingMessage = { id: null, content: '', elements: {} };
  createStreamingMessagePlaceholder();

  await sendMessageStream(sessionId, content, {
    onStart: (data) => updateStreamingHeader(data.agentName),
    onText: (data) => {
      state.streamingMessage.content += data.text;
      updateStreamingContent(state.streamingMessage.content);
    },
    onElementStart: (data) => {
      state.streamingMessage.elements[data.id] = { ...data, status: 'streaming' };
      renderStreamingElement(data.id);
    },
    onElementComplete: (data) => {
      state.streamingMessage.elements[data.id].status = 'pending';
      renderStreamingElement(data.id);
    },
    onElementResult: (data) => {
      state.streamingMessage.elements[data.id].result = data.result;
      renderStreamingElement(data.id);
    },
    onComplete: (data) => finalizeStreamingMessage(data),
  });
}
```

### Batch Mode

Wait for complete response, then render:

```javascript
async function processMessage(content) {
  showTypingIndicator();
  let response = await sendMessage(sessionId, content);
  hideTypingIndicator();
  state.messages.push({ role: 'assistant', content: response.content });
  renderMessages();
}
```

Toggle with `/stream on` or `/stream off` command.

## Modals

### New Session Modal

Creates a session with name, agent selection, and optional system prompt.

### Agents Modal

- Lists all agents with type badges
- "Add Agent" opens new agent form
- "Config" button opens JSON config editor
- "Delete" removes agent

### New Agent Modal

- **Name**: Display name
- **Base Type**: Dropdown (claude, openai)
- **Model**: Dropdown filtered by type
- **API URL**: Optional custom endpoint
- **API Key**: Password field
- **Default Processes**: Checkboxes

### Agent Config Modal

Raw JSON textarea for editing agent configuration:
- Validates JSON before save
- Shows error if invalid
- Common fields: model, maxTokens, temperature

### Processes Modal

Tabbed interface:
- **System tab**: Read-only system processes
- **My Processes tab**: User-created processes with edit/delete

### Edit Process Modal

- Name, description, content (markdown textarea)
- Validates name format

## Streaming UI

During streaming, a special message placeholder shows progressive updates:

```html
<div class="message message-assistant message-streaming" id="streaming-message">
  <div class="message-header">Assistant</div>
  <div class="message-bubble">
    <div class="streaming-content">
      <!-- Rendered HML content appears here progressively -->
    </div>
    <div class="streaming-elements">
      <!-- HML element cards appear here -->
      <div class="streaming-element streaming-element-executing" data-element-id="...">
        <div class="streaming-element-header">
          <span class="streaming-element-icon">🔍</span>
          <span class="streaming-element-type">websearch</span>
          <span class="streaming-element-status"><span class="spinner"></span></span>
        </div>
        <div class="streaming-element-content">hiking boots</div>
      </div>
    </div>
    <div class="streaming-indicator">
      <span></span><span></span><span></span>
    </div>
  </div>
</div>
```

### Element Status States

| Status | Icon | Description |
|--------|------|-------------|
| `streaming` | `...` | Content still arriving |
| `pending` | ⏳ | Element complete, awaiting execution |
| `executing` | 🔄 | Currently executing |
| `complete` | ✓ | Execution finished |
| `error` | ✗ | Execution failed |

### Streaming CSS

```css
.message-streaming .message-bubble {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-muted);
}

.streaming-indicator span {
  animation: streaming-pulse 1s infinite ease-in-out;
}

.streaming-element-executing .streaming-element-header {
  background: rgba(255, 217, 61, 0.15);
}

.spinner {
  animation: spin 0.8s linear infinite;
}
```

## Assertion Rendering

Messages can contain assertion blocks that render dynamically:

### Command Assertion

```html
<div class="assertion-block command" data-id="uuid-1">
  <div class="assertion-header">
    <span class="assertion-type">command</span>
    <span class="assertion-name">web_search</span>
    <span class="assertion-status running">running</span>
  </div>
  <div class="assertion-preview">
    <pre>Searching for "hiking boots"...</pre>
  </div>
</div>
```

### Thinking Assertion

```html
<div class="assertion-block thinking" data-id="uuid-2">
  <div class="thinking-indicator">
    <span></span><span></span><span></span>
  </div>
  <span class="thinking-text">Analyzing results...</span>
</div>
```

### Question Assertion

```html
<div class="assertion-block question" data-id="uuid-3">
  <div class="question-mode-label demand">Waiting for response</div>
  <div class="question-text">Does this look right?</div>
  <div class="question-actions">
    <button class="btn btn-primary" data-answer="yes">Yes</button>
    <button class="btn btn-secondary" data-answer="no">No</button>
    <input type="text" placeholder="Other..." class="question-input">
  </div>
</div>
```

Question modes:
- **demand**: Red label "Waiting for response", targets main input
- **timeout**: Orange label "Optional (30s)", shows countdown

## WebSocket Integration

Real-time updates via WebSocket:

```javascript
ws.onmessage = (event) => {
  let data = JSON.parse(event.data);

  switch (data.type) {
    case 'message_start':
      // Add placeholder message
      break;

    case 'message_chunk':
      // Append content
      break;

    case 'message_end':
      // Finalize message
      break;

    case 'assertion_update':
      // Update assertion block status/result
      break;

    case 'question_prompt':
      // Show question UI
      if (data.mode === 'demand') {
        state.activeDemandQuestion = data;
        focusMainInput();
      }
      break;

    case 'operation_start':
    case 'operation_complete':
    case 'operation_error':
      // Update operations panel
      break;
  }
};
```

## Event Handlers

### Session List

```javascript
// Search sessions
sessionSearch.addEventListener('input', debounce(() => {
  state.searchQuery = sessionSearch.value;
  fetchSessions();
}, 300));

// Toggle archived
toggleArchived.addEventListener('click', () => {
  state.showArchived = !state.showArchived;
  toggleArchived.classList.toggle('active');
  fetchSessions();
});

// Archive session
async function toggleSessionArchive(sessionId, archived) {
  let endpoint = archived ? 'unarchive' : 'archive';
  await fetch(`/hero/api/sessions/${sessionId}/${endpoint}`, { method: 'POST' });
  await fetchSessions();
}
```

### Chat Input

```javascript
// Send message or answer question
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (state.activeDemandQuestion) {
      answerQuestion(state.activeDemandQuestion.assertionId, messageInput.value);
    } else {
      handleSend();
    }
  }
});
```

## Styling

### CSS Variables

```css
:root {
  --bg-primary:    #1a1a2e;
  --bg-secondary:  #16213e;
  --bg-tertiary:   #0f3460;
  --accent:        #e94560;
  --accent-hover:  #ff6b6b;
  --accent-muted:  rgba(233, 69, 96, 0.3);
  --text-primary:  #eaeaea;
  --text-secondary: #a0a0a0;
  --text-muted:    #666;
  --border-color:  #2a2a4e;
  --success:       #4ecdc4;
  --error:         #ff6b6b;
  --warning:       #ffd93d;
  --info:          #64b5f6;
  --link:          #64b5f6;
  --link-hover:    #90caf9;

  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'Roboto Mono', 'Ubuntu Mono', 'Fira Code', Consolas, monospace;
}
```

All `<a>` tags use the link color by default and open in new tabs.

### Message Content Styling

```css
.message-content {
  font-family: var(--font-mono);
  font-size: 14px;
  line-height: 1.4;
  white-space: normal;      /* Collapses extra whitespace */
  word-break: break-word;
  overflow-wrap: break-word;
}

.message-content pre {
  white-space: pre-wrap;    /* Preserve whitespace in code blocks */
}

/* Headings: tight line-height, no margins */
.message-content h1, h2, h3, h4, h5, h6 {
  margin: 0;
  line-height: 1.2;
}

/* Lists: inside positioning prevents bullet overflow */
.message-content ul, ol {
  margin: 0;
  list-style-position: inside;
}

.message-content li {
  margin: 0;
  line-height: 1.35;
}
```

### Session Row Styling

```css
.session-row {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-color);
}

.session-row:nth-child(odd) {
  background: var(--bg-secondary);
}

.session-row:nth-child(even) {
  background: var(--bg-primary);
}

.session-row:hover {
  background: var(--bg-tertiary);
}

.session-row.archived {
  opacity: 0.6;
}
```

### Question Mode Styling

```css
.question-mode-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 4px;
  margin-bottom: 8px;
  display: inline-block;
}

.question-mode-label.demand {
  background: var(--error);
  color: white;
}

.question-mode-label.timeout {
  background: var(--warning);
  color: #333;
}
```

## Chat Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help information |
| `/clear` | Clear current chat |
| `/session` | Show session info |
| `/archive` | Archive current session |
| `/stream on\|off` | Toggle streaming mode |
| `/ability create\|list\|view\|delete` | Manage abilities |

```javascript
async function handleCommand(content) {
  let [command, ...args] = content.slice(1).split(/\s+/);

  switch (command.toLowerCase()) {
    case 'stream':
      handleStreamCommand(args.join(' '));
      break;
    case 'ability':
      await handleAbilityCommand(args.join(' '));
      break;
    // ...
  }
}

function handleStreamCommand(args) {
  if (args === 'on') {
    state.streamingMode = true;
    showMessage('Streaming mode enabled.');
  } else if (args === 'off') {
    state.streamingMode = false;
    showMessage('Streaming mode disabled.');
  } else {
    showMessage(`Streaming is ${state.streamingMode ? 'enabled' : 'disabled'}.`);
  }
}
```

## Web Components

Hero uses Mythix-UI as the base web component framework. Components extend `MythixUIComponent` or specialized base classes like `MythixUIModal`.

### Import Maps

Mythix-UI uses `@cdn/` style imports that must be resolved via an import map. This allows the same code to work with both CDN hosting and local development.

**Configuration in `index.html`:**

```html
<script type="importmap">
{
  "imports": {
    "@cdn/mythix-ui-core@1": "/mythix-ui/mythix-ui-core/dist/index.js",
    "@cdn/mythix-ui-modal@1": "/mythix-ui/mythix-ui-modal/dist/mythix-ui-modal.js"
  }
}
</script>
```

**Usage in components:**

```javascript
// Import from CDN-style path (resolved by import map)
import { MythixUIModal } from '@cdn/mythix-ui-modal@1';

export class HeroModal extends MythixUIModal {
  // Component implementation
}
```

The import map maps `@cdn/` paths to local `/mythix-ui/` paths during development. For production, these could point to a CDN URL instead.

### Hero Component Base Classes

Hero provides base classes that extend Mythix-UI:

| Class | Extends | Purpose |
|-------|---------|---------|
| `HeroComponent` | `MythixUIComponent` | Base for all Hero components |
| `HeroModal` | `MythixUIModal` | Base for modal dialogs |

**HeroComponent features:**
- `GlobalState` integration for reactive state
- `subscribeGlobal()` for state subscriptions
- `setGlobal()` for updating global state
- `processElements()` for event macro binding

**HeroModal features:**
- Native `<dialog>` element
- Auto-bound footer buttons via `slot="footer"`
- Escape key and backdrop click handling
- Error display helpers

### Modal Components

Modals use the native `<dialog>` element via MythixUIModal:

```javascript
export class HeroModalSession extends HeroModal {
  static tagName = 'hero-modal-session';

  get modalName() { return 'new-session'; }
  get modalTitle() { return 'New Session'; }

  getContent() {
    return `
      <form>
        <!-- Form fields -->
        <footer slot="footer">
          <button type="button" class="button button-secondary">Cancel</button>
          <button type="submit" class="button button-primary">Create</button>
        </footer>
      </form>
    `;
  }

  mounted() {
    this.render();
    super.mounted();
  }
}
```

**Key patterns:**
- `slot="footer"` - Footer buttons are auto-bound by MythixUIModal (click closes dialog)
- `getContent()` - Override to provide form content
- `handleSubmit()` - Override for form submission logic
- `onOpen()` / `onClose()` - Lifecycle hooks

**Opening modals:**

```javascript
// Dispatch show-modal event
document.dispatchEvent(new CustomEvent('show-modal', {
  detail: { modal: 'new-session' }
}));
```

### HML Prompt (`<hml-prompt>`)

Inline user prompt component for collecting input within chat messages.

**Location:** `public/js/components/hml-prompt.js`

**Features:**
- Shadow DOM encapsulation for isolated styling
- Auto-sizing input based on placeholder text
- Keyboard handling (Enter to submit for text/number)
- OK button for non-keyboard inputs (color, checkbox, select, radio, range)
- Answered state with green styling
- Inline display (newlines around tags are collapsed to spaces)

**Supported Types:**

| Type | Description | Attributes |
|------|-------------|------------|
| `text` | Free-form text input (default) | - |
| `number` | Numeric input | `min`, `max`, `step`, `default` |
| `color` | Color picker | `default` |
| `checkbox` | Single yes/no checkbox | `default` |
| `checkboxes` | Multi-select checkbox group | Requires `<data>` |
| `radio` | Radio button group | Requires `<data>` |
| `select` | Dropdown menu | Requires `<data>` |
| `range` | Slider | `min`, `max`, `step`, `default` |

**Options Format (for select/radio/checkboxes):**

Use a `<data>` child element with JSON array:
```html
<hml-prompt id="color" type="select">
  What's your favorite color?
  <data>[{"value":"red","label":"Red"},{"value":"blue","label":"Blue","selected":true}]</data>
</hml-prompt>
```

Option objects: `{ value, label, selected? }`

**Usage Examples:**
```html
<!-- Text (inline with surrounding text) -->
What's your name? <hml-prompt id="name">Enter your name</hml-prompt> Thanks!

<!-- Number -->
<hml-prompt id="age" type="number" min="1" max="120">How old are you?</hml-prompt>

<!-- Select dropdown -->
<hml-prompt id="size" type="select">
  Choose a size
  <data>[{"value":"s","label":"Small"},{"value":"m","label":"Medium"},{"value":"l","label":"Large"}]</data>
</hml-prompt>

<!-- Radio group -->
<hml-prompt id="rating" type="radio">
  Rate your experience
  <data>[{"value":"1","label":"Poor"},{"value":"3","label":"Average"},{"value":"5","label":"Excellent"}]</data>
</hml-prompt>
```

**After user answers:**
```html
<hml-prompt id="name" answered>Enter your name<response>Alice</response></hml-prompt>
```

**Events:**
- `prompt-submit` - Bubbles with `{ messageId, promptId, question, answer, type }`

**Styling:**
- Unanswered: Blue background tint, dashed bottom border, pulsing glow
- Answered: Green background tint, solid bottom border

**Inline Display:**
The markup processor collapses newlines around `<hml-prompt>` tags to spaces, ensuring prompts display inline with surrounding text. The `<data>` element is hidden via CSS.

## Scroll Behavior

The chat uses smart scrolling to avoid disrupting users reading older messages:

```javascript
// Only scrolls if user is near bottom (auto-follow)
function scrollToBottom() {
  if (isNearBottom()) {
    forceScrollToBottom();
  }
}

// Always scrolls (for explicit actions)
function forceScrollToBottom() {
  chatMain.scrollTop = chatMain.scrollHeight;
}
```

**When `forceScrollToBottom()` is used:**
- User sends a message
- User clicks scroll-to-bottom button

**When `scrollToBottom()` is used:**
- During streaming (text/elements arriving)
- After assistant response
- Other automatic updates

## File Structure

```
public/
├── index.html          # Main SPA with all modals
├── css/
│   ├── base.css        # Variables, reset
│   ├── chat.css        # Messages, streaming
│   ├── elements.css    # HML element styles
│   ├── assertions.css  # Assertion blocks
│   ├── modals.css      # Modal dialogs
│   └── ...
└── js/
    ├── app.js          # Main application logic
    ├── markup.js       # HML renderer
    └── components/
        └── hml-prompt.js  # Inline prompt Web Component
```

## API Functions

```javascript
async function fetchSessions() {
  let params = new URLSearchParams();
  if (state.showArchived) params.set('archived', 'true');
  if (state.searchQuery) params.set('search', state.searchQuery);

  let response = await fetch(`/hero/api/sessions?${params}`);
  let data = await response.json();
  state.sessions = data.sessions;
  renderSessionsList();
}

async function fetchAgents() {
  let response = await fetch('/hero/api/agents');
  let data = await response.json();
  state.agents = data.agents;
}

async function fetchProcesses() {
  let response = await fetch('/hero/api/processes');
  let data = await response.json();
  state.processes = data;
}

async function updateAgentConfig(agentId, config) {
  await fetch(`/hero/api/agents/${agentId}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
}
```

## Utility Functions

```javascript
function formatRelativeDate(dateString) {
  let date = new Date(dateString);
  let now = new Date();
  let diffMs = now - date;
  let diffMins = Math.floor(diffMs / 60000);
  let diffHours = Math.floor(diffMs / 3600000);
  let diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

function escapeHtml(text) {
  let div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}
```
