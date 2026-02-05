# Current Status

Last updated: 2026-02-05

## Recent Changes

### Interactions System (Complete)
Implemented a unified InteractionBus system for agent↔system↔user communication with function registration pattern.

**New files:**
- `server/lib/interactions/bus.mjs` - Central message bus with pub/sub
- `server/lib/interactions/function.mjs` - Base InteractionFunction class
- `server/lib/interactions/detector.mjs` - Detects interactions in agent responses
- `server/lib/interactions/functions/system.mjs` - Routes @system target interactions
- `server/lib/interactions/functions/websearch.mjs` - Web search function
- `spec/lib/interactions/interactions-spec.mjs` - 60 comprehensive tests

**Key concepts:**
- `InteractionFunction` base class with static `register()` method
- `PERMISSION` constants: ALWAYS, ASK, NEVER
- Dynamic agent instructions via `buildAgentInstructions()`
- Function classes registered with `registerFunctionClass(Class)`

### Message Types (Complete)
Added message type system for filtering hidden messages in UI.

**Database changes:**
- Migration 008: Added `type` column (message, interaction, system, feedback)
- Index on (session_id, type) for efficient queries

**UI changes:**
- "Show hidden messages" checkbox in chat toolbar
- Type badges for hidden messages (system, interaction, feedback)
- CSS styling for hidden message visibility

### UI Rename: Processes → Abilities (Complete)
Renamed "Processes" to "Abilities" throughout the user interface for consistency with the abilities system.

**Files changed:**
- `public/index.html` - Button labels, modal titles, form elements
- `public/js/app.js` - State variables, functions, DOM element references
- `public/css/agents.css` - CSS class names

### Ask Always Permission System (Complete)
Implemented a permission wrapper for commands that requires user approval every time.

**New files:**
- `server/lib/abilities/loaders/commands.mjs` - Command abilities loader
- `server/lib/operations/handlers/command.mjs` - Command operation handler

**Command abilities registered:**
- `command_ability` - Create, edit, delete abilities (Ask Always)
- `command_session` - Create, archive, spawn sessions (Ask Always)
- `command_agent` - List, configure, delete agents (Ask Always)

**How it works:**
- Commands use `autoApprovePolicy: 'never'` which means user approval is always required
- AI can invoke commands via the `command` operation handler
- Each invocation triggers the approval flow via WebSocket

### Session Status & Parent Hierarchy (Complete)
Replaced the boolean `archived` column with a flexible `status` system and added parent-child session relationships.

**Database changes:**
- Migration 006: Added `status` column (NULL, 'archived', 'agent', etc.)
- Migration 006: Added `parent_session_id` column for session hierarchy
- Migrated existing `archived=1` rows to `status='archived'`

**API changes:**
- GET /api/sessions now accepts `showHidden=1` (also supports legacy `archived=1`)
- Sessions are ordered with children grouped under their parents
- New PUT /api/sessions/:id/status endpoint for status updates
- All session responses include `status`, `parentSessionId`, `depth` fields

**Frontend changes:**
- Sessions list shows child sessions indented under parents
- Archived sessions have a red hue background
- Agent sessions have a blue hue background and "agent" badge
- Toggle button now shows/hides all hidden sessions (archived + agent)

### Hidden Messages Feature (Complete)
Implemented "suppressMessage" functionality to hide `__onstart_` messages from the chat UI while still sending them to the AI.

**Changes made:**
- `server/database.mjs` - Added migration 005_messages_hidden (adds `hidden` column to messages table)
- `server/routes/messages-stream.mjs` - Startup messages now stored with `hidden=1`
- `server/routes/messages.mjs` - Startup messages now stored with `hidden=1`, GET endpoint includes hidden flag
- `server/routes/sessions.mjs` - GET /:id includes hidden flag in messages response
- `public/js/app.js` - `renderMessages()` filters out hidden messages from display
- `docs/api.md` - Updated to document hidden field on messages
- `docs/server.md` - Updated to document hidden messages feature

## Architecture

### Interactions System

The interactions system replaces the old operations system with a unified message bus:

```
Agent Response
      │
      ▼
┌─────────────────┐
│ Detector        │ Finds @target(method, args) patterns
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ InteractionBus  │ Routes to registered handlers
└────────┬────────┘
         │
         ├─→ @system → SystemFunction router
         │              │
         │              ├─→ websearch → WebSearchFunction
         │              ├─→ bash → BashFunction
         │              └─→ ... (registered functions)
         │
         ├─→ @user → User notification
         │
         └─→ @agent → Message queue for agent
```

### Function Registration

Functions self-register with metadata:

```javascript
class WebSearchFunction extends InteractionFunction {
  static register() {
    return {
      name: 'websearch',
      permission: PERMISSION.ALWAYS,
      schema: {
        query: { type: 'string', required: true },
      },
      examples: [
        { method: 'search', args: { query: 'hiking boots' } },
      ],
    };
  }
}

registerFunctionClass(WebSearchFunction);
```

## Previous Session Work

- Fixed streaming export error (`EXECUTABLE_ELEMENTS` not exported from stream-parser.mjs)
- Fixed streaming freeze issue (UI stuck with typing indicator)
- Made `message_complete` event always fire, even on empty/error responses
- Made `finalizeStreamingMessage()` idempotent in frontend
