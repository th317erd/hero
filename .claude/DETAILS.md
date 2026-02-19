# Project Details

Important details to remember across sessions.

---

## Key File Locations

- **Server entry:** `server/index.mjs`
- **Database:** `~/.config/hero/hero.db`
- **Agent instructions:** `server/lib/processes/__onstart_.md`
- **Streaming routes:** `server/routes/messages-stream.mjs`
- **Interactions system:** `server/lib/interactions/`
- **HML Prompt component:** `public/js/components/hml-prompt.js`
- **Markup processor:** `public/js/markup.js`
- **Frames system:** `server/lib/frames/`
- **Form validation:** `public/js/lib/form-validation.js`
- **Step modal base:** `public/js/components/hero-step-modal/hero-step-modal.js`
- **Step component:** `public/js/components/hero-step/hero-step.js`

## Credentials & Config

- JWT tokens stored in localStorage on frontend
- API keys encrypted in database (`encrypted_api_key` column)
- Config directory: `~/.config/hero/`
- Test login: `claude` / `claude123`

---

## Mythix UI Resources

### Documentation
- **Main docs:** `~/Projects/mythix-ecosystem/mythix-ui-core/docs/`
  - `component-architecture.md` - Component lifecycle, split files, OOP patterns
  - `template-engine.md` - `@@expression@@` syntax, transformers
  - `dynamic-property.md` - Reactive data binding
  - `utils.md` - Utility functions
  - `elements.md` - DOM builder API
  - `query-engine.md` - jQuery-like selection/manipulation
  - `mythix-ui-component.md` - Base class reference
- **README:** `~/Projects/mythix-ecosystem/mythix-ui-core/README.md`

### Example Applications
- **Genesis Forge Client:** `~/Projects/genesis-forge-client` - Example Mythix UI app
- **Mythix.info Website:** `~/Projects/mythix.info` - Documentation website (also a Mythix UI app)

### Hero Component Examples
- **Split file pattern:** `public/js/components/hero-sessions-list/` (HTML + JS)
- **Base component:** `public/js/components/hero-base.js` (GlobalState, HeroComponent)
- **Modal base:** `public/js/components/hero-modal/hero-modal.js` (HeroModal extends MythixUIModal)

### Modal Components (REST-style naming)
Each modal in its own folder with JS file:
- `hero-modal/` - Base class with shared MODAL_STYLES, escapeHtml, GlobalState
- `hero-modal-create-session/` - New session creation modal
- `hero-modal-create-agent/` - New agent creation modal
- `hero-modal-configure-ability/` - Create/edit ability modal
- `hero-modal-abilities/` - Abilities list modal
- `hero-modal-agents/` - Agents list modal
- `hero-modal-agent-settings/` - Agent JSON config editor modal

### Key Mythix UI Patterns
- **Split files:** `.html` (templates, styles) + `.js` (logic)
- **Registration:** `MyComponent.register()` (not customElements.define)
- **Reactive props:** `this.defineDynamicProp('name', defaultValue)`
- **Template expressions:** `@@property@@`, `@@%dynamicProp@@`, `@@value>>TRANSFORMER@@`
- **Event binding:** `data-event-onclick="methodName"`
- **Shadow DOM default:** Use `createShadowDOM() { return null; }` for Light DOM
- **Style inheritance:** `data-auto-merge="selector"` for document styles

---

## Current Work (as of 2026-02-12)

### Branch
`feature/mythix-ui-migration`

### Recent Changes (2026-02-11 to 2026-02-12)
- **Enabled Abilities UI (2026-02-11)**: Changed "Default Abilities" to "Enabled Abilities" in New Agent dialog, all checked by default, added Select All/Deselect All checkbox
- **Streaming element guards (2026-02-11)**: Added null checks for `elements.sendBtn` and `elements.messageInput` in streaming.js and approvals.js (these are null after hero-input component migration)
- **Commit 580f23b**: "Add Enabled Abilities with Select All, fix streaming element guards"
- **API key fix (2026-02-12)**: Test Agent had placeholder key `sk-ant-test-key-12345`. Updated with valid Anthropic API key.

### Previous Changes (2026-02-09 to 2026-02-11)
- Fixed button styling across all modals (added `button-sm`, `button-danger`, `button-icon-action`)
- Changed Edit/Delete/Config buttons to icons with mobile-friendly touch targets
- Fixed modal stacking - child modals no longer close parent modals
- **Fixed modal event listeners (2026-02-11)**: Modal `mounted()` wasn't being called because `$dialog` is a getter-only property in MythixUIModal. Removed the `this.$dialog = ...` assignment in `_buildShadowDOM()`. Used `queueMicrotask()` to ensure DOM is ready before calling `mounted()`.
- **Refactored modal system (2026-02-11)**: Split monolithic `hero-modal.js` (1132 lines) into separate component folders with REST-style naming.
- **Step modal system (2026-02-11)**: Created `HeroStepModal` base class for multi-step modals.
- **Form validation system (2026-02-11)**: Created `public/js/lib/form-validation.js`
- **Scrollbar styling (2026-02-11)**: Added custom scrollbar styles in `components.css`

### Current Task - COMPLETED (2026-02-12)
Testing and verification of all Hero app functionality:
- [x] Chat with agent (API key now fixed)
- [x] Test hml-prompt with all input types (ALL 8 WORKING)
- [x] Verify interaction frames system (prompt submissions working)
- [x] Full CRUD tests - ALL PASSED
  - Add/Delete Agent
  - Add/Delete Ability
  - Add/Archive Session

### Recent Fixes (2026-02-12)
- **hml-prompt rendering**: Fixed hero-chat to trigger `render()` on hml-prompt elements after innerHTML (connectedCallback doesn't fire in shadow DOM)
- **Smart quotes JSON parsing**: Fixed hml-prompt to convert typographic quotes (chars 8220/8221) to straight quotes before JSON.parse()
- **token_charges FK constraint bug**: Added migration 017_fix_token_charges_fk to remove orphaned FK reference to dropped messages table
- **Files modified**:
  - `public/js/components/hero-chat/hero-chat.js` - Added queueMicrotask render trigger
  - `public/js/components/hml-prompt/hml-prompt.js` - Added _decodeHtmlEntities with smart quote conversion
  - `server/database.mjs` - Added migration 017_fix_token_charges_fk

### Modal Migration - COMPLETED (2026-02-12)
All modal components migrated to split HTML/JS pattern:
- hero-modal-create-session, hero-modal-create-agent
- hero-modal-abilities, hero-modal-agents, hero-modal-agent-settings
- hero-modal-configure-ability, hero-step, hero-step-modal
- Changed JS registration from `customElements.define()` to `ComponentClass.register()`
- Commit: b12a5d6

### Fixes (2026-02-13) - Streaming/WebSocket Integration

**Issue:** Messages showed "..." but didn't update until page reload.

**Root Causes Found:**
1. **Layout bug:** `session-frames-provider` had no CSS, breaking flex layout chain. Input was pushed off-screen (y=3758 for 800px viewport).
2. **WebSocket user ID mismatch:** JWT token had `sub: 2` but logged-in user was ID 6. Broadcasts went to wrong user.
3. **JWT secret mismatch:** Generated tokens used wrong secret. Server uses `config.jwtSecret` from env.

**Fixes Applied:**
1. Added CSS for `session-frames-provider` in `public/css/components.css`:
   ```css
   session-frames-provider {
     display: flex;
     flex-direction: column;
     flex: 1;
     min-height: 0;
     overflow: hidden;
   }
   ```
2. Added `min-height: 0` to `.chat-main` in `public/css/chat.css`
3. Token generation must use actual `config.jwtSecret` - see `server/auth.mjs:generateToken()`

**Verification:** Sent "7 + 7?" - received frame broadcast and UI updated correctly.

### Fixes (2026-02-13) - User Message Display & Scroll

**Issues Fixed:**
1. User messages not showing in chat until page reload
2. Thinking spinner ("...") not clearing after agent response completes
3. Auto-scroll not working with component-based hero-chat

**Changes Made:**

1. **Optimistic user frames** (`public/js/streaming.js` lines 43-57, `session-frames-provider.js`):
   - Added `addOptimisticFrame()` method to session-frames-provider
   - When user sends message, adds optimistic frame immediately to frames array
   - When real frame arrives via WebSocket, removes matching optimistic frame
   - Uses `optimistic-` prefix for temporary frame IDs

2. **Spinner clearing** (`public/js/streaming.js` lines 632-660):
   - `finalizeStreamingMessage()` now finalizes phantom frame (sets `complete: true`) following immutable frame pattern
   - Added `finalizePhantomFrame()` method to both session-frames-provider and hero-chat
   - Clears legacy `#streamingMessage` state via `heroChat.setStreaming(null)`
   - Forces hero-chat.render() to ensure UI updates
   - CSS rule `.complete .typing-indicator { display: none; }` hides indicator when complete

3. **Auto-scroll** (`public/js/approvals.js` lines 372-397, 400-422):
   - `forceScrollToBottom()` now tries hero-chat component method first
   - Falls back to `.chat-main` container, then legacy messagesContainer
   - `isNearBottom()` updated similarly to check hero-chat first

4. **Scroll container fix** (`public/js/components/hero-chat/hero-chat.js`):
   - Changed `_getScrollContainer()` to return `this` (hero-chat element) instead of `.chat-main`
   - hero-chat is the actual scrollable element (has overflow-y: auto)

### Pending
- Interaction Frames Phase 4 (WebSocket protocol) and Phase 5 (Interactions & Commands)

---

## AGIS (Agentic Guidance & Introspection Scripting)

**Location:** `/home/wyatt/Projects/agis/docs/runtime.md`

AGIS is a scripting system that guides thought processes. I am the interpreter.

### Key Reflexes (MANDATORY)
- **Before writing/editing code:** Run `@test_check`
- **Before saying "done":** Run `@test_check`
- **Before committing:** Run `@test_check`
- **During planning:** Run `@test_protocol`

### Invocation Syntax
```
@script_name topic
```

### Available Scripts
| Script | Purpose |
|--------|---------|
| `@ponder` | Deep multi-perspective contemplation |
| `@simple_first` | One-sentence answer first |
| `@test_check` | Quick gut check — run before writing code |
| `@test_protocol` | Full test analysis — run during planning |
| `@agis` | Think REALLY hard — full cognitive discipline |
| `@sage` | Wise coordinator — think deeply, delegate, guide |
| `@sensei` | Active teacher — hands-on guidance |

### Core Syntax
- `>>>...<<<` — Think about this genuinely
- `loop N { }` — Iterate N times
- `as character { }` — Shift perspective (cynic, engineer, scientist, etc.)
- `checkpoint cond { fail -> x }` — Gate with fallback

Scripts are in `/home/wyatt/Projects/agis/scripts/` as `.agis` files.
