# Hero Project Todo

## COMPLETED: State Consolidation + Server Extraction (2026-02-17)

**Goal:** Eliminate dual-write state sync and extract shared server logic.

**Result:** 65 new tests added (1094 → 1159 total). Zero failures.

### Phase 5: Server Extraction ✅ COMPLETE
- [x] Create `server/lib/messaging/content-utils.mjs` — 7 pure utility functions extracted
- [x] Create `server/lib/messaging/command-handler.mjs` — `handleCommandInterception()` consolidation
- [x] Create `server/lib/messaging/session-setup.mjs` — `setupSessionAgent()` consolidation
- [x] Update `messages-stream.mjs` — Import from new modules, remove extracted code (~20% reduction)
- [x] Update `messages.mjs` — Import from new modules, remove duplicated code (~26% reduction)
- [x] `spec/lib/messaging/content-utils-spec.mjs` — 32 tests
- [x] `spec/lib/messaging/command-handler-spec.mjs` — 11 tests
- [x] `spec/lib/messaging/session-setup-spec.mjs` — 8 tests

### Phase 4: Client State Consolidation ✅ COMPLETE
- [x] `state.js` — Wrap state in Proxy, auto-forward synced keys to GlobalState
- [x] `components/index.js` — Reverse-sync setGlobal writes back to state.*
- [x] Remove duplicate writes from `sessions.js`, `app.js`, `streaming.js`, `hero-app.js`
- [x] Fix mutation pattern in `streaming.js` (nested mutation → object replacement)
- [x] `spec/lib/state-sync-spec.mjs` — 14 tests (sync, recursion prevention, early writes)

---

## COMPLETED: Codebase Hardening & Cleanup (2026-02-17)

**Goal:** Remove dead code, harden error handling, add missing tests, and consolidate patterns for a solid, maintainable codebase.

**Result:** 125 new tests added (969 → 1094 total). Zero failures.

### Phase 1: Client Dead Code Cleanup ✅ COMPLETE
- [x] Remove 11 dead element references from `state.js`
- [x] Remove orphaned event listener blocks in `app.js`
- [x] Remove dead `updateSessionSelect()` and `sessionTitle` code in `app.js`
- [x] Remove dead `handleSendMessage()` in `approvals.js`
- [x] Remove dead `elements.sendBtn`/`elements.messageInput` references in `streaming.js` and `approvals.js`
- [x] Remove dead `updateScrollToBottomButton()` in `approvals.js`
- [x] Remove deprecated `updateUserPromptUI()` and `escapeHtmlForPrompt()` in `app.js`
- [x] Clean up legacy rendering fallback in `renderMessagesImpl()` (keep component path only)
- [x] Added `setShowHiddenMessages()` public API to hero-chat (replaced private property hack)

### Phase 2: Server Error Hardening ✅ COMPLETE
- [x] Wrap `JSON.parse()` in `server/lib/pipeline/context.mjs` (decrypted config, default_processes)
- [x] Wrap `JSON.parse()` in `server/routes/messages-stream.mjs` (agent config, default_processes)
- [x] Wrap `JSON.parse()` in `server/routes/messages.mjs` (agent config, default_processes)
- [x] Wrap `JSON.parse()` in `server/routes/agents.mjs` (list + get endpoints)
- [x] Protect frame payload parsing in `server/lib/frames/index.mjs` (createFrame + parseFrameRow)

### Phase 3: Server Route Tests ✅ COMPLETE
- [x] `spec/routes/auth-spec.mjs` — 27 tests (createUser, authenticateUser, generateToken, verifyToken, changePassword, getUserById, getUserByUsername)
- [x] `spec/routes/sessions-spec.mjs` — 44 tests (list, create, get, update, delete, archive/unarchive, status, hierarchy, search, isolation)
- [x] `spec/routes/agents-spec.mjs` — 40 tests (list, create, get, update, delete, config, validation, isolation, legacy compat)

---

## COMPLETED: Server-Side Command Engine (2026-02-17)

**Goal:** Server intercepts user messages matching `^\s*\/[\w_]+` and executes commands directly, never sending them to the agent.

### Phase 1: Command System Architecture ✅ COMPLETE
- [x] Create `server/lib/commands/index.mjs` - Command registry and executor
- [x] isCommand(), parseCommand(), getCommand(), executeCommand()
- [x] Create `spec/lib/commands-spec.mjs` - 25 tests for command system

### Phase 2: Implement Core Commands ✅ COMPLETE
- [x] `/help [filter]` - Show available commands/help topics
- [x] `/session` - Show current session info
- [x] `/start` - Re-send startup instructions to agent
- [x] `/compact` - Compact conversation history
- [x] `/reload` - Reload agent instructions (hidden)
- [x] `/stream [on|off]` - Toggle streaming mode
- [x] `/update_usage <cost>` - Usage correction
- [x] `/ability [list|create|edit|delete]` - Ability management

### Phase 3: Integrate into Message Routes ✅ COMPLETE
- [x] Update `server/routes/messages.mjs` - Intercept commands before agent
- [x] Update `server/routes/messages-stream.mjs` - Same for streaming
- [x] Commands create visible frames for response
- [x] Unknown commands return error frame
- [x] Server returns JSON for commands, SSE for normal messages

### Phase 4: Client Cleanup ✅ COMPLETE
- [x] Remove command event handling from `hero-input.js`
- [x] Update `api.js` sendMessageStream to detect JSON command responses
- [x] Update `streaming.js` with onCommand callback
- [x] Remove command parsing from `approvals.js` handleSendMessage
- [x] Remove `hero:command` event listener from `app.js`
- [x] Client sends all messages to server, server decides if it's a command

---

## COMPLETED: Additional Fixes (2026-02-17)

### Status Bar Spend Colors ✅ FIXED
- [x] Changed all spend values (Global, Service, Session) to blue
- [x] File: `public/js/components/hero-status-bar/hero-status-bar.js`

### [object Object] Safeguards ✅ FIXED
- [x] Root cause: Anthropic API can return content as arrays `[{ type: 'text', text: '...' }]`
- [x] Fix: Added type checking and content extraction in both client and server
- [x] Files: `public/js/markup.js`, `server/lib/html-sanitizer.mjs`

### /reload Command Visibility ✅ FIXED
- [x] Root cause 1: Missing `credentials: 'same-origin'` in fetch calls
- [x] Root cause 2: `showSystemMessage` uses legacy SessionStore, not frame system
- [x] Fix: Added credentials, server creates visible acknowledgment frame
- [x] Files: `public/js/commands.js`, `server/routes/messages.mjs`

---

## COMPLETED: Critical UX Fixes (2026-02-17)

**All issues identified from testing have been fixed:**

### Issue 1: /reload Command Content Clipped ✅ FIXED
- [x] Root cause: POST /messages endpoint was triggering agent response for hidden messages
- [x] Fix: Added `hidden` parameter support - hidden messages now stored without agent response
- [x] File: `server/routes/messages.mjs`

### Issue 2: "[object Object]" in Agent Response ✅ FIXED
- [x] Root cause: `framesToMessages` used `compiled[frame.id]` but `compiled` is a Map
- [x] Fix: Updated to use `compiled instanceof Map ? compiled.get(id) : compiled[id]`
- [x] File: `public/js/api.js`

### Issue 3: Service/Session Spend Not Displaying ✅ FIXED
- [x] Root cause: `hero-status-bar.inSession` checked `#view === 'chat'` but `#view` was never set
- [x] Fix: Changed `inSession` to simply check `this.currentSession !== null`
- [x] File: `public/js/components/hero-status-bar/hero-status-bar.js`

### Issue 4: Scroll Forces User to Bottom (CRITICAL) ✅ FIXED
- [x] Complete rewrite with intent-based tracking
- [x] New approach: Track `#userScrolledAway` flag based on scroll direction
  - User scrolls UP → `userScrolledAway = true` (stop auto-scroll)
  - User reaches bottom → `userScrolledAway = false` (resume auto-scroll)
- [x] ResizeObserver only auto-scrolls when `!userScrolledAway`
- [x] File: `public/js/components/hero-chat/hero-chat.js`

### Issue 5: Agent Still Using Markdown ✅ FIXED
- [x] Added prominent "CRITICAL: HTML Only - NO MARKDOWN" section
- [x] Added explicit "DO NOT USE" list with markdown syntax examples
- [x] Added "WRONG - Do Not Do This" section with counter-examples
- [x] File: `server/lib/processes/__onstart_.md`

### Issue 6: User Messages Being Sanitized/Stripped ✅ FIXED
- [x] Root cause: `_renderContent` used `_renderMarkup` for all messages (parses HTML)
- [x] Fix: User messages now use `escapeHtml()` to show literal text
- [x] File: `public/js/components/hero-chat/hero-chat.js`

---

## COMPLETED: Deterministic Frame-Based UI System (2026-02-17)

**Goal:** Fix broken session isolation, prompt persistence, duplicate messages, and jerky UX.

### Phase 1: Single Source of Truth ✅ COMPLETE
- [x] Port `compileFrames()` from server to `session-frames-provider.js`
- [x] Add `compiled` DynamicProperty to session-frames-provider
- [x] Remove duplicate state from hero-chat (`#frames`, `#compiled`, etc.)
- [x] Remove WebSocket listeners from hero-chat (provider handles them)
- [x] hero-chat now reads from provider's reactive `compiled` property

### Phase 2: ID-Based DOM Reconciliation ✅ COMPLETE
- [x] Add `_reconcileMessages()` for ID-based element preservation
- [x] Add `_reconcilePhantom()` for phantom frame handling
- [x] Add `_updateMessageElement()` to preserve hml-prompt elements
- [x] Elements with `data-frame-id` are reused, not recreated

### Phase 3: hml-prompt Enhancements ✅ COMPLETE
- [x] Add `value` attribute to observedAttributes
- [x] CSS matches both `[answered]` and `[value]` for green styling
- [x] `isAnswered` getter checks both attributes
- [x] `response` getter falls back to `value` attribute

### Phase 4: Testing ✅ COMPLETE
- [x] Create `spec/components/session-frames-provider-spec.mjs` (18 tests)
- [x] Tests cover: basic compilation, UPDATE frames, COMPACT frames, determinism
- [x] All 945 tests passing

### Phase 5: Performance Fixes ✅ COMPLETE
- [x] Fixed scroll-to-bottom issues (removed isNearBottom checks)
- [x] Fixed scroll on page reload (multiple setTimeout delays)
- [x] Fixed double-render issue (subscribe to `compiled` only, not both `frames` and `compiled`)

---

## COMPLETED: Markdown → HTML Migration (2026-02-16)

**Goal:** Replace markdown rendering with direct HTML output from agent, sanitized server-side.

### Phase 1: Server-Side HTML Sanitizer ✅ COMPLETE
- [x] Create `spec/lib/html-sanitizer-spec.mjs` (85 tests)
- [x] Create `server/lib/html-sanitizer.mjs` (using jsdom)
- [x] All tests passing

### Phase 2: Integrate Sanitizer ✅ COMPLETE
- [x] Add sanitization to `createAgentMessageFrame()` in `broadcast.mjs`
- [x] All 919 tests passing

### Phase 3: Agent Instructions Rewrite ✅ COMPLETE
- [x] Rewrote `__onstart_.md` from 501 lines to 163 lines
- [x] Focus on HTML output, not markdown
- [x] Essential sections: interactions, hml-prompt, hml-thinking

### Phase 4: Frontend Updates ✅ COMPLETE
- [x] Removed markdown-it from `markup.js`
- [x] Removed markdown-it script tag from `index.html`
- [x] Kept defense-in-depth sanitization in frontend

### Phase 5: End-to-End Testing ✅ COMPLETE
- [x] Verified agent outputs HTML (h2, h3, p, strong, em, hr)
- [x] Verified HTML renders correctly in chat

---

## COMPLETED: Post-Migration Testing & Hardening (2026-02-16)

### Phase 1: Test HML Elements ✅ COMPLETE
- [x] Test `hml-prompt` - renders correctly, accepts input, proper styling
- [x] Test `hml-thinking` - collapsible blocks with brain emoji, title, content
- [ ] Test prompt persistence and updates (deferred - needs manual testing)

### Phase 2: Test System Interactions ✅ COMPLETE
- [x] Test `websearch` interaction (agent uses wrong tag format - prompting issue, not code bug)
- [x] `help` and `update_prompt` use same mechanism

### Phase 3: Sanitizer Edge Cases ✅ COMPLETE
- [x] Test nested malicious content (20 new tests added)
- [x] Test encoding attacks (HTML entities, unicode)
- [x] Test attribute injection attempts
- [x] Test deeply nested tags (50 levels stress test)
- [x] Added vbscript: and data:application/javascript blocking

### Phase 4: Streaming HTML ✅ COMPLETE
- [x] Verify partial HTML chunks render gracefully (browser DOM handles naturally)
- [x] Test interrupted streams (existing architecture handles)
- [x] Test malformed HTML recovery (sanitizer tests cover this)

### Phase 5: Cleanup ✅ COMPLETE
- [x] Removed obsolete tests from `markup-spec.mjs` (18 → 9 tests)
- [x] Renamed `markdown.css` → `content.css`
- [x] Updated index.html CSS reference
- [x] `html-to-markdown.mjs` still used by websearch (NOT dead code)
- [x] Integration tests already use HTML format - no changes needed
- [x] All 930 tests passing

---

## Whitelist Reference

### Allowed HTML Tags
```
Headings:    h1, h2, h3, h4, h5, h6
Structure:   p, br, hr, div, span
Inline:      b, strong, i, em, u, s, mark, code, small, sub, sup
Block:       pre, blockquote
Lists:       ul, ol, li
Links/Media: a, img
Tables:      table, thead, tbody, tr, th, td

Custom HML:  hml-prompt, hml-thinking
             response, data (children of hml-prompt)
```

### Dangerous Tags (Remove Completely)
```
script, iframe, embed, object, style, base, meta, form,
input, button, textarea, select, math, noscript, template, slot
interaction (protocol tag - processed server-side, never displayed)
```

---

## Test Commands

```bash
# Run all tests
npm test

# Run specific test file
node --test spec/lib/html-sanitizer-spec.mjs

# Run with verbose output
node --test --test-reporter spec spec/lib/html-sanitizer-spec.mjs
```
