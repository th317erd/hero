# Hero - AI Agent Runner

Hero is a web-based interface for running AI agents with a rich assertion-based operation system. It supports multiple agent types (Claude, OpenAI) with encrypted configuration, real-time streaming, and dynamic chat UI.

## Key Features

- **Multi-agent support** - Claude and OpenAI with pluggable architecture
- **Encrypted storage** - API keys, configs, and messages encrypted at rest
- **Streaming responses** - Real-time SSE streaming with progressive HML parsing
- **Hero Markup Language (HML)** - Rich elements for websearch, bash, questions, todos
- **Unified Abilities** - Processes and functions with permission system
- **Assertion pipeline** - Typed operations (command, question, response, thinking)
- **Question modes** - Demand (wait forever) and timeout (auto-proceed)
- **Session archiving** - Soft-delete with recovery
- **Real-time UI** - WebSocket + SSE streaming with dynamic assertion blocks

## Project Structure

```
hero/
├── server/
│   ├── index.mjs            # Express entry point
│   ├── database.mjs         # SQLite with migrations
│   ├── encryption.mjs       # AES utilities
│   ├── routes/              # API endpoints
│   │   ├── messages.mjs     # Batch message handling
│   │   ├── messages-stream.mjs  # SSE streaming endpoint
│   │   └── abilities.mjs    # Abilities CRUD
│   ├── middleware/          # Auth middleware
│   └── lib/
│       ├── agents/          # Agent implementations
│       ├── abilities/       # Unified abilities system
│       │   ├── registry.mjs
│       │   ├── executor.mjs
│       │   └── loaders/     # Builtin, system, user, plugin loaders
│       ├── interactions/    # Interaction system
│       │   ├── bus.mjs      # InteractionBus pub/sub
│       │   ├── function.mjs # Base InteractionFunction class
│       │   ├── detector.mjs # Pattern detection
│       │   └── functions/   # Function implementations
│       ├── markup/          # HML parsing
│       │   ├── parser.mjs   # Batch parser
│       │   ├── stream-parser.mjs  # Streaming parser
│       │   └── executor.mjs
│       ├── assertions/      # Assertion type handlers
│       ├── processes/       # System processes
│       ├── plugins/         # Plugin system
│       └── websocket.mjs    # Real-time handling
├── spec/                    # Unit tests
│   └── lib/                 # Tests mirror lib/ structure
├── public/
│   ├── index.html           # Main SPA
│   ├── css/                 # Modular styles
│   │   ├── chat.css         # Chat + streaming styles
│   │   └── ...
│   └── js/
│       ├── app.js           # Frontend logic
│       └── markup.js        # HML renderer
├── docs/                    # Documentation
└── nginx/                   # Reverse proxy config
```

## URLs

- **Base**: `https://wyatt-desktop.mythix.info/hero/`
- **Sessions**: `https://wyatt-desktop.mythix.info/hero/sessions/{id}`
- **Login**: `https://wyatt-desktop.mythix.info/hero/login`
- **API**: `https://wyatt-desktop.mythix.info/hero/api/...`
- **WebSocket**: `wss://wyatt-desktop.mythix.info/hero/ws`

## Quick Start

```bash
# Install dependencies
npm install

# Create a user
npm run add-user

# Start server
npm start
```

## Documentation

- [Architecture Overview](./architecture.md) - System design, streaming, HML pipeline
- [Agent System](./agents.md) - Agent types, config, context
- [Frontend Design](./frontend.md) - UI, streaming, HML rendering
- [API Reference](./api.md) - All endpoints, SSE events, WebSocket messages

## Core Concepts

### Hero Markup Language (HML)

Rich markup elements for agent responses:

```html
<!-- Executable elements (run on server) -->
<websearch>hiking boots reviews</websearch>
<bash>ls -la</bash>
<ask timeout="30" default="skip">Should I continue?</ask>

<!-- Display elements -->
<thinking>Analyzing the request...</thinking>
<todo title="Setup Tasks">
  <item status="completed">Install dependencies</item>
  <item status="in_progress">Configure database</item>
</todo>
<progress value="75" max="100">Processing files</progress>
```

### Streaming vs Batch Mode

Hero supports two message processing modes:

- **Streaming (default)** - Real-time SSE with progressive HML parsing
- **Batch** - Wait for complete response, then process

Toggle with `/stream on` or `/stream off` command.

### Interactions

Agents communicate with the system using a target/method/args pattern:

```
@system(websearch, { query: "hiking boots" })
@user(notify, { message: "Task complete" })
@agent(queue, { message: "Follow-up task" })
```

The interactions system provides:
- **InteractionBus** - Central message routing
- **InteractionFunction** - Base class with `static register()` for metadata
- **Permission levels** - ALWAYS (auto), ASK (prompt user), NEVER (deny)

### Assertions (Legacy)

Legacy assertion format still supported:

```json
{
  "id": "uuid",
  "assertion": "command",
  "name": "web_search",
  "message": "hiking boots"
}
```

Types: `command`, `question`, `response`, `thinking`, `link`, `todo`, `progress`

### Abilities

Unified system for processes (instruction macros) and functions (executable code):

```javascript
{
  name: 'my_ability',
  type: 'function',        // or 'process'
  source: 'user',          // builtin, system, user, plugin
  permissions: {
    autoApprove: false,
    dangerLevel: 'moderate'
  }
}
```

### Startup Abilities

Abilities with names matching `_onstart_*` automatically inject on session start:
- `__onstart_` (double underscore) - Highest priority, runs first
- `_onstart_welcome` - Standard priority

### Question Modes

- **demand** - Waits forever for user input
- **timeout** - Auto-proceeds with default after N ms

### Rich Context

All handlers receive full context:

```javascript
{
  userId, sessionId, dataKey,
  agent: { id, name, type, config, defaultProcesses },
  session: { id, name, systemPrompt },
  signal, pipeline
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
