# Hero Project Todo

## Completed
[x] Startup abilities (`_onstart_*` pattern) - implemented and working
[x] Abilities system consolidation (processes + functions = abilities)
[x] Hidden messages feature - startup messages hidden from UI but sent to AI
[x] Streaming HML parser with progressive element detection
[x] Fixed streaming freeze issue (message_complete always fires)
[x] Session status system - replaced `archived` boolean with flexible `status` column
[x] Parent session hierarchy - `parent_session_id` for agent sub-sessions
[x] Session UI grouping - child sessions indented under parents
[x] Session status styling - archived (red hue), agent (blue hue)
[x] Renamed "Processes" to "Abilities" throughout the UI
[x] "Ask Always" permission system for commands
[x] Command abilities: /ability, /session, /agent (with user approval)
[x] Have every dynamic "function" or "command" wrapped in an async permission layer
[x] "Default Processes" in Agent config should have a "Select All" checkbox
[x] Refresh processes list when Agent config dialog opens
[x] `/skill` command for creating named process abilities
[x] Show agent name (not "Assistant") in chat bubbles
[x] Allow agent to suggest commands for user to copy/paste (explicit control)

## In Progress

### Interaction Frames Implementation

**Phase 1: Database Foundation**
- [ ] Create `frames` table with new schema
- [ ] Drop old `messages` table
- [ ] Write frame CRUD functions
- [ ] Tests for frame operations

**Phase 2: Frame Core Library**
- [ ] `createFrame()`, `getFrames()`, `getFramesBySession()`
- [ ] `compileFrames()` — replay/compilation logic
- [ ] Target ID parsing utilities
- [ ] Tests for compilation

**Phase 3: Server-Side Frame Loop**
- [ ] Refactor `messages-stream.mjs` to create frames
- [ ] Frame-based context builder for agent calls
- [ ] API endpoint: `GET /api/sessions/:id/frames`
- [ ] Tests for agent turn frame creation

**Phase 4: WebSocket Protocol**
- [ ] Change WS to emit frames (including phantoms)
- [ ] Fetch frames via API on load, WS for real-time
- [ ] Tests for frame streaming

**Phase 5: Interactions & Commands**
- [ ] Refactor websearch to emit request/result frames
- [ ] Other commands follow same pattern
- [ ] Parent/child frame relationships
- [ ] Tests for interaction chains

**Phase 6: Compaction**
- [ ] Trigger compaction logic
- [ ] Agent generates compact frame
- [ ] Load-from-compact logic
- [ ] Tests for compact + reload

**Notes:**
- Client updates deferred (big plans coming)
- Keep code plugin-ready (modular, clean interfaces)
- Code in `server/lib/frames/`

---

## Architecture: Interaction Frames

### Problem Statement
The application has grown complex. The hml-prompt implementation struggles because there are too many moving parts between frontend rendering, server-side state, and persistence that don't compose well. We need to tighten up the agent layer with better separation of concerns.

### Core Idea: Event Sourcing for Conversations
All conversation activity becomes immutable "interaction frames" — like git commits or database binlog entries. The current state is *derived* by replaying frames from the beginning (or from a checkpoint).

**Principles:**
1. Server-side is 100% self-contained, can run headless
2. Frontend is just a frame renderer/subscriber
3. Single source of truth — replay frames = exact state
4. The "agent loop" is tight and isolated

**Analogy:** Git for conversations. Each frame is a commit. State is built by replaying commits.

### Open Design Questions

**1. Frame Granularity**
When agent sends a message with `<interaction>` block, do we split into:
- Frame: `agent_text` (prose before/after)
- Frame: `interaction_request` (websearch/prompt/etc)

Or is the whole response one frame with embedded structure?

**2. Prompt Responses**
When user answers an hml-prompt:
- New frame that *references* the original prompt frame?
- Or does it "patch" the original frame (more git-like)?

**3. Database Schema**
- Replace `messages` table with `interaction_frames`?
- Or layer frames on top of existing messages?

**4. Real-time Streaming**
- Frames emit in real-time as created?
- Frontend streams frames, not raw text?

**5. Replay Performance**
- For 500-frame conversation, replay all on page load?
- Checkpoints mandatory at certain intervals?

### Emerging Design

**Frame Structure:**
```
interaction_frame {
  id:           uuid
  session_id:   int (scoped to session)
  user_id:      int (scoped to user)
  parent_id:    uuid | null (for extracted sub-frames)
  target_id:    string | null ("@frame:xyz", "@element:prompt-123", etc.)
  timestamp:    high-resolution UTC (sub-ms, ordering is sacred)
  type:         string (message, interaction_request, interaction_response, etc.)
  payload:      json (the actual content/data)
}
```

**Target ID Prefixes:**
- `@frame:` - references another frame
- `@system:` - system target
- `@user:` - user target
- `@element:` - element within a frame (e.g., hml-prompt)

**Flow:**
1. User sends message → Frame `type: user_message`
2. Agent responds → Frame `type: agent_message`
3. Agent response has `<interaction>` blocks → Extract as child frames with `parent_id` → original
4. User answers hml-prompt → Frame `type: prompt_response`, `target_id: @element:prompt-id`
5. On load → "Compile" frames in timestamp order; response frames mutate original frame's rendered state

**Key Insight:** Store "fully resolved" compiled result so agent sees clean context with prompts already answered.

### Resolved Decisions

1. **Streaming** — Websocket protocol becomes FRAME-ONLY. Use "phantom frames" (not persisted) for real-time visual feedback (thinking indicator, partial content). Real frames emitted on completion.

2. **Storage** — `interaction_frames` REPLACES `messages` table entirely. A message IS a frame.

3. **History & Compaction:**
   - Full history kept forever in DB (debugging, memory recall)
   - COMPACT frames are checkpoints; client view starts from last compact
   - Frames targeting "before" compact: client ignores missing targets gracefully

4. **Dual Access Pattern:**
   - Websocket: streams frames real-time (including phantoms)
   - API: returns persisted frames (from compact forward)
   - No websocket replay needed; fetch via API, then subscribe

### Frame Operations (Simplified)

Only TWO operations:
1. **CREATE** — New message frame
2. **UPDATE** — Replace previous message content (declarative, full replacement)

No patches, no diffs. Update = emit frame with full new content.

### Phantom Frames

- NOT persisted to database
- Used for real-time visual cues (thinking, streaming preview)
- Automatically replaced when real frame arrives

### Resolved: Immutable Logs

Update frames store FULL new content. Original frames never modified. Compilation system builds the "effective view" by replaying frames.

### Frame Compilation System

```
compileFrames(frames):
  compiled = Map<frameId, content>

  for frame in frames (sorted by timestamp, from compact point):
    if message:  compiled.set(frame.id, frame.payload)
    if update:   compiled.set(frame.target_id, frame.payload)  // replace
    if compact:  load snapshot from payload

  return compiled
```

**Properties:** Idempotent, order-dependent, graceful with missing targets, compact-aware.

### Frame Types (Minimal)

| Type | Description |
|------|-------------|
| `message` | New message (user/agent/system), has `role` field |
| `update` | Replaces content of target frame |
| `compact` | Checkpoint snapshot, starting point |

### Frame Schema (Draft)

```sql
CREATE TABLE frames (
  id            TEXT PRIMARY KEY,  -- uuid
  session_id    INTEGER NOT NULL,
  parent_id     TEXT,              -- parent frame (nullable)
  target_ids    TEXT,              -- JSON array: ["agent:123", "user:456", "frame:xyz"]
  timestamp     TEXT NOT NULL,     -- high-resolution UTC, ISO format

  type          TEXT NOT NULL,     -- message | request | result | update | compact
  author_type   TEXT NOT NULL,     -- user | agent | system
  author_id     INTEGER,           -- user.id or agent.id, null for system

  payload       TEXT NOT NULL,     -- JSON content

  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_frames_session ON frames(session_id, timestamp);
CREATE INDEX idx_frames_parent ON frames(parent_id);
```

### Target ID Format

Prefixed strings for easy querying:
- `agent:123` — targets an agent
- `user:456` — targets a user
- `frame:abc-def` — targets another frame
- `element:prompt-xyz` — targets element within a frame

### Interaction Flow Example

```
Frame A: Agent message (contains <interaction> block)
  └── Frame B: WebSearch request (parent_id: A, target_ids: ["system:websearch"])
        └── Frame C: WebSearch result (parent_id: B, target_ids: ["agent:123"])
Frame D: Agent response (implicitly confirms C was delivered)
```

### Delivery Tracking

**Decision: Implicit delivery, no explicit tracking for now.**

- Agent's response proves it saw previous frames
- Conversation flow IS the audit trail
- Design allows adding `context_delivery` frame type later if needed

### Compact Frames

- Type: `compact`
- Content: **Agent-generated** summary/compression
- Agent decides what context to carry forward (references, key facts, pending items)
- On reload: start from most recent compact, load frames forward from there
- Historical frames before compact: still in DB forever, just not loaded for display

### No Deletes

Immutable log = no deletes. Ever.
- To "hide" something: `update` frame with `hidden: true` or empty payload
- Original frame stays in log forever
- Full history always available for debugging/recall

### Discussion Log
*(Ongoing)*

---

## Pending
[ ] Debug "Show hidden messages" checkbox - debug logging added, needs user testing to verify behavior
[ ] Add token scalar setting for adjusting cost calculation ratio (mentioned in update_usage requirements)

## Recently Completed (2026-02-07)
[x] `<hml-prompt>` Web Component - full-featured inline user prompts
    - All input types: text, number, color, checkbox, checkboxes, radio, select, range
    - JSON options via `<data>` element for select/radio/checkboxes
    - OK button for non-keyboard inputs (color, select, checkbox, range)
    - Inline display (newlines collapsed, `<p>` tags unwrapped)
    - `<data>` element hidden via CSS
    - Select dropdown improved styling (white background, dark text)
    - Persistence working via interaction system

## Recently Completed (2026-02-06)
[x] Token charges system - records every API call with agent_id, session_id, message_id, cost
[x] 3-line spend display: Global Spend (all agents), Service Spend (same API key), Session Spend
[x] Private messages column - for user-only messages not sent to agent
[x] Compacting memory - improved prompt to capture comprehensive context AND generate TODO lists
[x] Add "Chevron Down" button to jump to bottom of chat - floats at bottom-right, auto-hides when near bottom
[x] Add `/update_usage <cost>` command - stores corrections in database, adjusts tracking to match actual spend
[x] Unit tests for token charges system - 30 tests covering cost calculation, spend queries, corrections
[x] Unified test runner - converted all spec files from Jest to Node.js built-in test runner (177 tests total)
[x] Scroll behavior improvements - auto-follow only when near bottom, force scroll on user message
[x] Scroll-to-bottom button repositioned - centered horizontally, chevron centered in circle
[x] Fixed SQL error in usage routes - changed `api_key` to `encrypted_api_key`
[x] User message interaction processing - server now executes `<interaction>` tags in user messages

## Architecture Notes
- **Abilities** = verbal "guides" for the agent, applied when the agent feels they should
- **Sources**: builtin, system, user, plugin
- **Hidden messages**: `hidden=1` in messages table, filtered in frontend but sent to AI
- **Startup abilities**: `_onstart_*` pattern, `__onstart_` runs first (double underscore = higher priority)

## Work Process Notes
- Use Browser automation MCP (Puppeteer) for visual debugging, and testing all HTML changes (that can be verified via unit tests)
- Use Test Driven Development ALWAYS... decide what you want to build, write important test coverage for whatever it is that you are building, and then write the system to pass the tests. Use Browser automation MCP (Puppeteer) when you are debugging things (real time), use JSDOM, or whatever framework is needed to properly test your work.
- Always keep in mind Wyatt's skills and quirks (/home/wyatt/.claude-config/quirks.md), and apply them when writing code or planning tasks.