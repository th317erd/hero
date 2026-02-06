# Current Status

Last updated: 2026-02-06

## Recent Changes

### TODO List Updates (Complete)
Implemented several improvements from the project TODO list.

**Scroll-to-Bottom Button:**
- Added a chevron button that appears when user scrolls up in chat
- Button floats in the bottom-right corner of the messages container
- Click scrolls smoothly to the latest message
- Auto-hides when user is near the bottom

**Files changed:**
- `public/index.html` - Added scroll-to-bottom button element
- `public/js/state.js` - Added button and chatMain element references
- `public/js/app.js` - Added `isNearBottom()`, `updateScrollToBottomButton()`, scroll event handler
- `public/css/chat.css` - Added `.scroll-to-bottom-btn` styling

**Header Usage Display:**
- Moved cost/token display from floating position to header bar
- Shows two line items: Global usage and Session usage
- Session usage only visible in chat view
- Global usage fetched on authentication and updated in real-time

**Files changed:**
- `public/index.html` - Added usage display elements to both headers
- `public/js/state.js` - Added `globalCost` state object
- `public/js/api.js` - Added `fetchUsage()` function
- `public/js/app.js` - Rewrote `updateCostDisplay()`, added `loadGlobalUsage()`
- `public/js/routing.js` - Call `loadGlobalUsage()` on authentication
- `public/css/layout.css` - Added `.header-usage` styling
- `public/css/chat.css` - Removed old floating cost display

**Usage Correction Command:**
- Added `/update_usage <cost>` command for correcting token tracking
- User provides actual API cost, system calculates and stores correction
- Corrections are persisted in new `usage_corrections` database table
- Usage API now includes corrections in totals

**Files changed:**
- `server/database.mjs` - Added migration 011 for `usage_corrections` table
- `server/routes/usage.mjs` - Added correction endpoints, updated GET to include corrections
- `server/routes/index.mjs` - Registered usage routes
- `public/js/api.js` - Added `createUsageCorrection()` function
- `public/js/app.js` - Added `handleUpdateUsageCommand()`, registered command

**Improved Memory Compaction:**
- Enhanced compaction prompt to capture comprehensive context
- Now generates TODO lists during compaction
- Improved snapshot loading with clearer context markers

**Files changed:**
- `server/lib/compaction.mjs` - Updated `buildCompactionPrompt()` and snapshot loading

**Debug Logging for Hidden Messages:**
- Added console logging to help debug "Show hidden messages" checkbox
- Logs message counts when loading sessions and toggling checkbox

### Web Search Banner Timing Fix (Complete)
Fixed critical issue where the "Web Search: Pending" banner appeared simultaneously with search results instead of immediately when the search started.

**Root causes identified and fixed:**
1. **SSE event parsing bug** - `eventType` and `eventData` were reset on every chunk, breaking events that span multiple chunks. Moved variables outside the parsing loop.
2. **Interaction events timing** - Now send `interaction_started` at `<websearch>` opening tag (not closing tag) for immediate banner display.
3. **Nginx buffering** - Added `gzip off`, `proxy_cache off`, `chunked_transfer_encoding on` to prevent SSE buffering.
4. **Event loop yielding** - Added `setImmediate()` yield between sending events and blocking operations.

**New features:**
- `interaction_update` event - Updates banner content when full query is known
- Elapsed time display - Banner shows "Completed in X.Xs" instead of just "Complete"
- Text shadows on message content and timestamps for improved readability

**Files changed:**
- `server/routes/messages-stream.mjs` - Restructured websearch handling with proper event timing
- `public/js/api.js` - Fixed multi-chunk SSE parsing, added `interaction_update` handler
- `public/js/app.js` - Added `onInteractionUpdate`, `formatElapsedTime`, `updateInteractionBannerContent`
- `public/js/markup.js` - Removed duplicate websearch banner rendering (now handled by interaction events)
- `nginx/locations.nginx-include` - SSE buffering prevention settings
- `public/css/chat.css` - Text shadow on timestamps
- `public/css/markdown.css` - Text shadow on message content

### UI/UX Improvements (Complete)
Various improvements to the chat interface and styling.

**CSS changes:**
- Fixed `white-space: pre-wrap` causing large gaps (changed to `normal`, kept `pre-wrap` on code blocks)
- Fixed horizontal text overflow with `min-width: 0` and `overflow-wrap: break-word`
- Balanced line-heights: body text 1.4, list items 1.35, headings 1.2
- Zero vertical margins for tight, consistent spacing
- Added dedicated link color variables (`--link`, `--link-hover`, `--info`)
- Fixed bullet point overflow with `list-style-position: inside`

**Link handling:**
- All markdown links now open in new tabs (`target="_blank"`)
- Added `rel="noopener noreferrer"` for security
- Links use new light blue color (`#64b5f6`) that fits the dark theme

**Message timestamps:**
- "Just now" only shows for first 5 minutes
- After 5 minutes, shows human-readable time (e.g., "2:30 PM", "yesterday 4:15 PM")

### Content Accumulation Fix (Complete)
Fixed issue where interaction responses would replace original message content.

**Problem:** When an agent sent a message with an `<interaction>` tag, the follow-up response would completely replace the original text.

**Solution:** Server now accumulates all content segments (initial message + follow-up responses) and combines them in the final output.

**Changes:**
- `server/routes/messages-stream.mjs` - Track `contentSegments` array instead of replacing `currentContent`
- Added regex to strip leaked feedback format (`[@system:...]`) from final output
- Clean up extra whitespace in combined content

### System Prefix Rename (Complete)
Changed system ability prefix from `system_` to `_` for cleaner naming.

**Changes:**
- Renamed `act.md` → `think.md`
- Updated `isSystemProcess()` to check for `_` prefix
- Changed `system_web_search` → `_web_search`
- Updated validation to prevent user abilities starting with `_`

### Abilities UI Enhancements (Complete)
- Added "applies" field to ability edit modal (describes when to use the ability)
- Added type badges: green "function", purple "command", blue "ability"
- Fixed user abilities not showing in list (added `loadUserAbilities()` call)
- Added sessionStorage persistence for modal draft fields

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
