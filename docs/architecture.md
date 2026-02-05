# Architecture Overview

## High-Level Design

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (SPA)                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Session: dev │  │ Session: prod│  │ Session: test│  (tabs)  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
└─────────┼─────────────────┼─────────────────┼──────────────────┘
          │                 │                 │
          └────────────────┬┴─────────────────┘
                           │ HTTP/SSE/WebSocket
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      nginx (reverse proxy)                       │
│              https://wyatt-desktop.mythix.info/hero/             │
└─────────────────────────────────────────────────────────────────┘
                           │
                           │ strips /hero/ prefix
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Node.js Server (Express)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Auth      │  │   Routes    │  │  WebSocket  │              │
│  │  (JWT)      │  │  (API/SSE)  │  │   Handler   │              │
│  └─────────────┘  └─────────────┘  └──────┬──────┘              │
│                                           │                      │
│  ┌────────────────────────────────────────┴──────────────────┐  │
│  │                  Streaming HML Pipeline                    │  │
│  │   Text Stream → Parser → Element Events → Execution       │  │
│  └────────────────────────────────────────┬──────────────────┘  │
│                                           │                      │
│  ┌────────────────────────────────────────┴──────────────────┐  │
│  │                   Interactions System                      │  │
│  │   Detector → InteractionBus → Function Handler → Result   │  │
│  └────────────────────────────────────────┬──────────────────┘  │
│                                           │                      │
│  ┌────────────────────────────────────────┴──────────────────┐  │
│  │                    Agent Abstraction                       │  │
│  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │  │
│  │   │ ClaudeAgent │  │ OpenAIAgent │  │    ...      │       │  │
│  │   └─────────────┘  └─────────────┘  └─────────────┘       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                           │
                           │ API calls (streaming)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                External APIs (Claude, OpenAI, etc.)              │
└─────────────────────────────────────────────────────────────────┘
```

## Core Concepts

### Sessions

A **session** is a named conversation with an agent. Sessions are:

- **Named** - Identified by database ID, displayed by name
- **Persistent** - Stored in SQLite with encrypted messages
- **Independent** - Each browser tab can have a different session
- **User-scoped** - Sessions belong to authenticated users
- **Archivable** - Soft-delete via archive flag, recoverable

### Agents

An **agent** is a configured AI backend. Each agent has:

- **Type** - The base provider (claude, openai)
- **API Key** - Encrypted, never exposed to frontend
- **Config** - JSON blob merged into API calls (model, maxTokens, etc.)
- **Default Processes** - System prompts automatically included

### Hero Markup Language (HML)

**HML** is a custom markup format for rich agent responses:

#### Executable Elements
Execute on the server, results returned to agent:

| Element | Purpose | Attributes |
|---------|---------|------------|
| `<websearch>` | Web search | - |
| `<bash>` | Shell command | `cwd`, `timeout` |
| `<ask>` | User question | `timeout`, `default`, `options` |

#### Display Elements
Rendered in the UI only:

| Element | Purpose | Attributes |
|---------|---------|------------|
| `<thinking>` | Processing indicator | - |
| `<todo>` | Task list | `title` |
| `<item>` | Todo item (inside todo) | `status` |
| `<progress>` | Progress bar | `value`, `max`, `status` |
| `<link>` | Clickable link | `href` |
| `<copy>` | Copy button | `label` |
| `<result>` | Command output | `for`, `status` |

### Abilities

**Abilities** are the unified system for all extensibility:

- **Processes** - Instruction macros with templating (skills, prompts)
- **Functions** - Executable code (websearch, bash, plugins)

```javascript
{
  id: string,
  name: string,
  type: 'function' | 'process',
  source: 'builtin' | 'system' | 'user' | 'plugin',
  content?: string,           // For processes
  execute?: Function,         // For functions
  permissions: {
    autoApprove: boolean,
    dangerLevel: 'safe' | 'moderate' | 'dangerous',
  }
}
```

#### Startup Abilities

Abilities with names matching `_onstart_*` inject on session start:
- `__onstart_` (double underscore) runs first
- Sorted by underscore count descending, then alphabetically

### Interactions System

**Interactions** are the communication format between agents and the system. The agent uses a simple target/method/args pattern:

```
@system(websearch, { query: "hiking boots" })
@user(notify, { message: "Done!" })
@agent(queue, { message: "Follow-up task" })
```

The interactions system consists of:

- **InteractionBus** - Central pub/sub message router
- **Detector** - Parses agent responses for `@target(method, args)` patterns
- **InteractionFunction** - Base class for all function handlers
- **SystemFunction** - Routes @system calls to registered function classes

#### Function Registration

All functions inherit from `InteractionFunction` and self-register with metadata:

```javascript
class WebSearchFunction extends InteractionFunction {
  static register() {
    return {
      name:       'websearch',
      permission: PERMISSION.ALWAYS,
      schema: {
        query: { type: 'string', required: true },
      },
      examples: [
        { method: 'search', args: { query: 'hiking boots' } },
      ],
    };
  }

  async search({ query }) {
    // Implementation
  }
}

registerFunctionClass(WebSearchFunction);
```

#### Permission Levels

```javascript
const PERMISSION = {
  ALWAYS: 'always',  // Auto-approve
  ASK:    'ask',     // Prompt user
  NEVER:  'never',   // Always deny
};
```

### Assertions (Legacy)

**Assertions** are the legacy operation format, still supported for backwards compatibility:

```json
{ "id": "...", "assertion": "command", "name": "web_search", "message": "..." }
```

Assertion types:
- `command` - Execute an operation
- `question` - Prompt user for input
- `response` - Display message to user
- `thinking` - Show processing status
- `link` - Clickable reference
- `todo` - Task list
- `progress` - Progress indicator

## Data Flow

### Streaming Message Flow (Default)

```
User types message
       │
       ▼
Frontend sends POST /api/sessions/{id}/messages/stream
       │
       ▼
Server sets up SSE connection
       │
       ▼
Server builds rich context (agent, session, user)
       │
       ▼
Agent API called with streaming enabled
       │
       ▼
┌──────────────────────────────────────┐
│     Streaming HML Pipeline           │
│  ┌─────────────────────────────────┐ │
│  │ For each text chunk:            │ │
│  │   → Feed to StreamingHMLParser  │ │
│  │   → Emit SSE: text event        │ │
│  │                                 │ │
│  │ On element_start:               │ │
│  │   → Emit SSE: element_start     │ │
│  │                                 │ │
│  │ On element_update:              │ │
│  │   → Emit SSE: element_update    │ │
│  │                                 │ │
│  │ On element_complete:            │ │
│  │   → Emit SSE: element_complete  │ │
│  │   → If executable: execute      │ │
│  │   → Emit SSE: element_result    │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
       │
       ▼
SSE: message_complete
       │
       ▼
Frontend updates UI progressively
```

### Batch Message Flow (Legacy)

```
User types message
       │
       ▼
Frontend sends POST /api/sessions/{id}/messages
       │
       ▼
Server builds rich context (agent, session, user)
       │
       ▼
Message sent to Agent API (non-streaming)
       │
       ▼
Response parsed for HML elements
       │
       ▼
┌──────────────────────────────────────┐
│      Assertion Pipeline              │
│  ┌─────────────────────────────────┐ │
│  │ For each assertion:             │ │
│  │   → Validate format             │ │
│  │   → Determine sequential/parallel│ │
│  │   → Execute through handlers    │ │
│  │   → Broadcast via WebSocket     │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
       │
       ▼
Results sent back to agent (if command)
       │
       ▼
Final response via HTTP
```

### SSE Event Types

```javascript
// Message lifecycle
{ event: 'message_start', data: { messageId, sessionId, agentName } }
{ event: 'text', data: { messageId, text } }
{ event: 'message_complete', data: { messageId, content, executedElements } }

// HML element lifecycle
{ event: 'element_start', data: { messageId, id, type, attributes, executable } }
{ event: 'element_update', data: { messageId, id, type, content, delta } }
{ event: 'element_complete', data: { messageId, id, type, content, executable, duration } }
{ event: 'element_executing', data: { messageId, id, type } }
{ event: 'element_result', data: { messageId, id, type, result } }
{ event: 'element_error', data: { messageId, id, type, error } }

// Tool use (for agents with native tools)
{ event: 'tool_use_start', data: { messageId, toolId, name } }
{ event: 'tool_result', data: { messageId, toolId, content } }

// Errors
{ event: 'error', data: { messageId, error } }
```

### Question Flow

```
Agent emits question assertion / <ask> element
       │
       ▼
Question handler detects mode:
├─ demand: Wait forever for user response
└─ timeout: Wait N ms, then use default
       │
       ▼
WebSocket: question_prompt sent to frontend
       │
       ▼
Frontend shows question UI
├─ demand: Targets main input, waits
└─ timeout: Shows countdown, input optional
       │
       ▼
User responds (or timeout fires)
       │
       ▼
WebSocket: question_response sent to server
       │
       ▼
Question handler resolves promise
       │
       ▼
Pipeline continues with answer
```

### WebSocket Message Types

```javascript
// Server → Client
{ type: 'message_start', sessionId, messageId }
{ type: 'message_chunk', sessionId, messageId, content }
{ type: 'message_end', sessionId, messageId }
{ type: 'assertion_update', messageId, assertionId, status, result }
{ type: 'question_prompt', messageId, assertionId, question, mode, timeout }
{ type: 'operation_start', sessionId, operationId, command }
{ type: 'operation_complete', sessionId, operationId, result }
{ type: 'operation_error', sessionId, operationId, error }

// Stream broadcasts (SSE events mirrored to WS for other clients)
{ type: 'stream_text', sessionId, messageId, text }
{ type: 'stream_element_start', sessionId, ... }
{ type: 'stream_element_complete', sessionId, ... }

// Client → Server
{ type: 'abort', sessionId }
{ type: 'question_response', assertionId, answer }
{ type: 'ability_approval_response', executionId, approved }
```

## Key Design Decisions

### Dual Message Modes

Supporting both streaming and batch modes enables:
- **Streaming** - Better UX with progressive rendering, real-time feedback
- **Batch** - Simpler debugging, deterministic behavior, FIFO processing

Toggle via `/stream on|off` command.

### Progressive HML Parsing

The `StreamingHMLParser` uses EventEmitter pattern:
- Buffers partial tags until complete
- Emits events as elements are detected
- Handles nested elements and malformed markup gracefully
- Executes elements as they complete (not waiting for full response)

### Unified Abilities

Consolidating processes, commands, functions into abilities enables:
- Single registry for all extensibility
- Consistent permission model
- Plugin system with ability exports
- Startup injection via naming convention

### Assertion-Based Operations

Moving from simple commands to typed assertions enables:
- Different handling per assertion type
- Questions that can block or timeout
- Status updates without blocking
- Parallel execution of independent tasks

### Middleware Pipeline

All operations flow through the same pipeline:
- Handlers can transform, intercept, or pass through
- Easy to add cross-cutting concerns (logging, rate limiting)
- Handlers are sorted alphabetically for predictable order

### Encrypted Storage

Sensitive data is encrypted at rest:
- Messages use per-user data keys
- Agent API keys encrypted
- Agent configs encrypted
- User processes encrypted

## File Structure

```
server/
├── server.mjs              # Express server entry
├── database.mjs            # SQLite connection & migrations
├── encryption.mjs          # AES encryption utilities
├── config.mjs              # Configuration loading
├── routes/
│   ├── auth.mjs            # Login/logout
│   ├── sessions.mjs        # Session CRUD
│   ├── messages.mjs        # Batch message handling
│   ├── messages-stream.mjs # SSE streaming endpoint
│   ├── agents.mjs          # Agent CRUD + config
│   ├── abilities.mjs       # Abilities CRUD
│   ├── processes.mjs       # Process CRUD (legacy)
│   └── help.mjs            # Help endpoint
├── middleware/
│   └── auth.mjs            # JWT verification
├── lib/
│   ├── agents/             # Agent implementations
│   │   ├── agent.mjs       # Base class
│   │   ├── claude-agent.mjs
│   │   └── index.mjs       # Registry
│   ├── abilities/          # Unified abilities
│   │   ├── index.mjs       # Exports
│   │   ├── registry.mjs    # Ability registry
│   │   ├── executor.mjs    # Execution with approval
│   │   └── loaders/        # Load abilities by source
│   │       ├── builtin.mjs
│   │       ├── system.mjs
│   │       ├── user.mjs
│   │       ├── plugin.mjs
│   │       └── startup.mjs
│   ├── markup/             # HML parsing
│   │   ├── index.mjs       # Exports
│   │   ├── parser.mjs      # Batch parser
│   │   ├── stream-parser.mjs # Streaming parser
│   │   └── executor.mjs    # HML execution
│   ├── operations/         # Operation handling
│   │   ├── index.mjs       # Detection & parsing
│   │   ├── executor.mjs    # Pipeline execution
│   │   └── registry.mjs    # Handler registry
│   ├── interactions/       # Interaction system
│   │   ├── index.mjs       # Exports
│   │   ├── bus.mjs         # InteractionBus pub/sub
│   │   ├── function.mjs    # Base InteractionFunction class
│   │   ├── detector.mjs    # Detects @target patterns
│   │   └── functions/      # Function implementations
│   │       ├── system.mjs  # @system router
│   │       └── websearch.mjs
│   ├── assertions/         # Assertion type handlers
│   │   ├── command.mjs
│   │   ├── question.mjs
│   │   ├── response.mjs
│   │   └── thinking.mjs
│   ├── processes/          # System processes
│   │   ├── index.mjs       # Loader
│   │   ├── act.md          # Action system
│   │   └── __onstart_.md   # Startup instructions
│   ├── plugins/            # Plugin system
│   │   └── loader.mjs
│   └── websocket.mjs       # WS connection handling
public/
├── index.html              # Main SPA
├── css/
│   ├── base.css            # Variables, reset
│   ├── chat.css            # Messages, streaming
│   ├── elements.css        # HML element styles
│   └── ...
└── js/
    ├── app.js              # Frontend logic
    └── markup.js           # HML renderer
```
