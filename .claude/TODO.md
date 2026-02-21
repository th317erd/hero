# Hero V1 Implementation

## S1: MessageStore — Single Source of Truth
> Status: **COMPLETE** — dual-state rendering bug killed

### What was done
- [x] Removed dual-write: streaming.js no longer writes to BOTH SessionStore AND session-frames-provider
- [x] Removed #messages fallback: hero-chat.visibleMessages reads exclusively from session-frames-provider
- [x] Removed legacy setMessages/addMessage methods from hero-chat
- [x] Removed legacy phantom frame fallbacks (hero-chat direct, DOM manipulation)
- [x] Simplified renderMessagesImpl: only syncs streaming state, doesn't push messages
- [x] Cleaned up finalizeStreamingMessage: single provider path
- [x] Cleaned up removeStreamingMessagePlaceholder: single provider path
- [x] Wrote 16 integration tests (STATE-001 through STATE-005, GUARD-003, RENDER-002)
- [x] All 1660 tests passing, 0 failures

### What remains (deferred to S2/S3)
- SessionStore still used for prompt operations (answerPrompt, findUnansweredPrompts) — S3 will redesign
- Legacy WS message handlers (handleNewMessage, handleMessageAppend) still update SessionStore — S2 will unify
- showSystemMessage still writes to SessionStore — low priority, converts to frames later

---

## Phase 0: Complete Frame Migration
> Status: **COMPLETE** — verified server emits `new_frame` exclusively

- [x] Audit legacy `new_message`/`message_append` emissions — confirmed dead
- [x] Frame types locked: MESSAGE, REQUEST, RESULT, UPDATE, COMPACT
- [x] Interaction frames (request/result) work end-to-end

## Phase 1: Multi-party Sessions
> Status: **SERVER COMPLETE** — client enhancements pending
> Commit: d1f1e50

### Server (complete)
- [x] Create `session_participants` table migration (018)
- [x] Populate from existing `agent_id` + `user_id` data
- [x] Make `agent_id` nullable on sessions (backwards compat)
- [x] Create participant CRUD helpers (add, remove, list, update role)
- [x] Rewrite `sessions.mjs` routes to use participants
- [x] Rewrite `messages-stream.mjs` to load agent from participants
- [x] Rewrite `messages.mjs` to load agent from participants
- [x] Rewrite `pipeline/context.mjs` to read from participants
- [x] Rewrite `commands/index.mjs`, `command-handler.mjs`, `commands.mjs`, `usage.mjs`
- [x] Write unit tests for participant CRUD (47 tests)
- [x] Write integration tests for sessions with participants (68 tests)
- [x] All 1244 tests passing

### Client (core complete, enhancements pending)
- [x] Update `api.js` to support `agentIds` array
- [x] Update session creation modal for multi-agent selection (coordinator + member checkboxes)
- [x] Add CSS styles for agent checkbox list
- [x] E2E verified: modal → API → session with participants → chat view
- [ ] Add participant list sidebar in chat view
- [ ] Add `@mention` autocomplete from participant list
- [ ] Update WebSocket broadcast to target all session participants
- [ ] Write E2E tests

## Phase 2: Permissions System
> Status: **CORE COMPLETE** — prompt UX and advanced features pending
> Commits: a9ea37b (engine), 6a7ce5c (routes)

### Engine + API (complete)
- [x] Create `permission_rules` table migration (019)
- [x] Build permission engine (`server/lib/permissions/index.mjs`)
- [x] Implement `evaluate(subject, resource, context)` → allow/deny/prompt
- [x] Implement specificity-based resolution (most specific wins, deny beats allow)
- [x] Wire into BEFORE_COMMAND hook via command-handler.mjs
- [x] Wire BEFORE_COMMAND/AFTER_COMMAND plugin hooks
- [x] Permission management API routes (GET/POST/DELETE /api/permissions + evaluate endpoint)
- [x] Ownership enforcement, session scoping, validation
- [x] Write exhaustive unit tests (65 engine + 7 integration + 68 route = 140 tests)
- [x] Write property-based tests for deterministic resolution
- [x] All 1321 tests passing

### Pending (deferred to Phase 3+)
- [ ] Wire BEFORE_TOOL hook into interaction detector (needs Phase 3 agent execution)
- [ ] Integrate approval flow for `prompt` action (needs Phase 3 agent-as-subject)
- [ ] Build permission prompt UX (`<hml-prompt>`)
- [ ] Implement meta-permissions (who can modify rules)
- [ ] Structured command arguments for all commands

## Phase 3: Agent Roles & Coordination
> Status: **CORE COMPLETE** — advanced features pending
> Commits: (pending)

### Engine + Functions (complete)
- [x] Coordinator/member roles on session_participants (from Phase 1)
- [x] Build `DelegateFunction` — coordinator delegates to member agents via interaction system
- [x] Build `ExecuteCommandFunction` — agents invoke commands, gated by permissions
- [x] Recursion depth enforcement (max 10 delegation exchanges)
- [x] Coordinator context includes session participants (enriched with names/types)
- [x] Execution context passed through to system functions (dataKey, agentId, etc.)
- [x] New functions registered in interaction system (delegate, execute_command)
- [x] Write delegate function unit tests (16 tests)
- [x] Write execute_command function unit tests (17 tests)
- [x] Write coordination integration tests (14 tests)
- [x] All 1378 tests passing

### Pending (deferred to Phase 3+)
- [ ] Inter-agent streaming (member responses streamed back to coordinator)
- [ ] Multiple coordinator discussion protocol
- [ ] @mention routing from user messages to specific agents
- [ ] Participant list sidebar in chat view (client)
- [ ] Wire BEFORE_TOOL hook for agent tool permission gating

## Phase 4: Commands + Plugin Hardening
> Status: **CORE COMPLETE**
> Commit: (pending)

### Commands (complete)
- [x] /participants — list all session participants with roles
- [x] /invite <agentId> [role] — add agent to session
- [x] /kick <agentId> — remove agent from session
- [x] /history [count] — show recent conversation history (max 100)
- [x] /export [format] — export conversation (text, json, markdown)
- [x] 36 new command tests

### Plugin Hardening (complete)
- [x] Internal plugins directory (`server/plugins/`)
- [x] Plugin dependency declaration (`hero.dependencies` in package.json)
- [x] Dependency resolution (topological sort with circular detection)
- [x] Plugin hot-reload (`reloadPlugin()`, `watchPluginsDirectory()`)
- [x] Dependency-safe unloading (blocks unload if dependents exist)
- [x] Dual discovery (internal + user plugins, user overrides internal)
- [x] Plugin source tracking ('internal' vs 'user')
- [x] Wire BEFORE_USER_MESSAGE hook into both message routes
- [x] Wire AFTER_AGENT_RESPONSE hook into both message routes
- [x] BEFORE_COMMAND/AFTER_COMMAND already wired (from Phase 2)
- [x] 27 new plugin loader tests

### Pending (deferred)
- [ ] npm package plugin support (resolve from node_modules)
- [ ] fs.watch auto-reload (function exists, needs server startup wiring)

## Phase 5: HML Forms + Infinite Scroll
> Status: **CORE COMPLETE**

- [x] Paginated frames API (`GET /frames?before=<ts>&limit=50`) with `hasMore` flag
- [x] Cross-session search endpoint (`GET /api/search`)
- [x] Client infinite scroll on scroll-to-top (scroll position preservation)
- [x] Group prompts per message with Submit All / Ignore buttons
- [x] Batch submission for multiple prompts (multiple `<interaction>` blocks per message)
- [x] Tests (12 pagination + 17 search + 13 route = 42 new tests)

## Phase 6: Auth Enhancement + User Settings
> Status: **CORE COMPLETE** — UI pending

### DB Migrations (020) — DONE
- [x] `magic_link_tokens` table (token, user_id, email, expires_at, used_at)
- [x] `api_keys` table (key_hash, key_prefix, user_id, name, scopes, expires_at, last_used_at)
- [x] Add `email` and `display_name` columns to `users` table

### Magic Link Auth — DONE
- [x] `POST /api/users/auth/magic-link/request` — generate token, call `sendEmail()` stub
- [x] `GET /api/users/auth/magic-link/verify?token=<token>` — validate, issue JWT (limited session)
- [x] Tokens single-use, 15-minute expiry
- [x] `sendEmail()` stub logs to console

### API Keys — DONE
- [x] `POST /api/users/me/api-keys` — create key, return plaintext once
- [x] `GET /api/users/me/api-keys` — list keys (no plaintext, show last_used_at)
- [x] `DELETE /api/users/me/api-keys/:id` — revoke key
- [x] Auth middleware extended: accepts `Authorization: Bearer <api-key>` header

### User Profile API — DONE
- [x] `GET /api/users/me/profile` — full profile (display_name, email, created_at, usage stats)
- [x] `PUT /api/users/me/profile` — update display_name, email (duplicate email check)
- [x] `PUT /api/users/me/password` — change password (re-issues JWT)

### Tests — DONE
- [x] 22 magic link unit tests (generation, validation, expiry, replay, cleanup, email stub)
- [x] 29 API key unit tests (creation, hash storage, listing, revocation, validation, expiry, scopes)
- [x] 12 user route tests (profile CRUD, usage stats, API keys, magic links, password change)
- [x] All 1595 tests passing

### Pending (deferred)
- [ ] User settings UI component (hero-settings page)
- [ ] API key scope enforcement in middleware

## Phase 7: Server-Authoritative Hardening
> Status: **CORE COMPLETE**

### Approval Hardening — DONE
- [x] Add userId to pending approvals map (verify owner on response)
- [x] WebSocket: pass userId + requestHash to handleApprovalResponse
- [x] Prevent duplicate approval resolution (atomic delete from pending map)
- [x] Generate SHA-256 request hash of ability+params on approval request
- [x] Verify hash matches on approval response (prevent replay)
- [x] Backward compatibility: allow approval without userId or hash

### sender_id Enforcement — DONE
- [x] Non-streaming messages route: add agentId to interaction context, clarify no senderId for agent interactions
- [x] Bus `respond()`: verify responding user matches interaction's user_id
- [x] WebSocket interaction_response handler passes authenticated userId

### Security Tests — DONE
- [x] Approval ownership verification tests (accept correct user, reject wrong user, backward compat)
- [x] Request hash verification tests (accept match, reject mismatch, backward compat)
- [x] Duplicate resolution prevention tests
- [x] Denial flow with security context tests
- [x] Session approval grant tests
- [x] sender_id enforcement tests (inclusion, exclusion, user vs agent distinction)
- [x] Bus respond() user verification tests
- [x] Interaction creation integrity tests
- [x] All 1595 tests passing

### Pending (deferred)
- [ ] Self-approval prevention (agents can't approve own actions — needs agent subject tracking)
- [ ] Nonce for cross-session replay prevention
- [ ] Chained command permissions UX (visual approval chain)

## Phase 8: File Uploads, Avatars, Rich Content
> Status: **CORE COMPLETE**

### File Uploads — DONE
- [x] Migration 021: `uploads` table + `avatar_url` column on agents
- [x] Upload route: `POST /api/sessions/:sessionId/uploads` (multer, 10MB limit, type validation)
- [x] Upload serving: `GET /api/uploads/:id` (ownership-verified)
- [x] Upload listing: `GET /api/sessions/:sessionId/uploads`
- [x] Upload deletion: `DELETE /api/uploads/:id`
- [x] Uploads directory helper in config-path.mjs
- [x] Client: drag-and-drop + paste handling in hero-input
- [x] Client: file preview chips (thumbnail for images, name for files)
- [x] Client: `API.uploads` namespace (upload, list, delete)
- [x] Client: file references appended to message on send

### Agent Avatars — DONE
- [x] Deterministic SVG avatar generation (initials + hash-based color)
- [x] `getAgentAvatar()` / `getUserAvatar()` helpers
- [x] Agents CRUD updated: accept `avatarUrl`, return generated or custom avatar
- [x] Sessions API returns `avatarUrl` for agents
- [x] `loadSessionWithAgent()` includes `avatar_url` in agent data
- [x] Client: avatar display in message headers (hero-chat)

### Rich Content Extension Points — DONE
- [x] Content type registry: `server/lib/content/index.mjs`
- [x] `registerContentType()` / `unregisterContentType()` / `getContentRenderer()`
- [x] Server-side `transformContent()` for payload transforms
- [x] `listContentTypes()` includes built-in (text, markdown, code, image, file) + custom
- [x] `isKnownContentType()` check
- [x] Plugin-friendly: source tracking, clientComponent/clientScript fields

### Client File/Image Rendering — DONE
- [x] `_renderAttachments()` in hero-chat (image preview + file link chips)
- [x] CSS for attachment images, file chips, avatar badges
- [x] Image lightbox (click to open in new tab)

### Tests — DONE
- [x] 22 avatar tests (initials, colors, generation, agent/user helpers)
- [x] 19 content registry tests (register, unregister, render, transform, list)
- [x] 16 upload tests (table schema, CRUD, cascade, config helpers)
- [x] All 1614 tests passing

### Pending (deferred)
- [ ] Message visibility / screenshots (plugin)
- [ ] Agent avatar picker UI in create/edit modal
- [ ] Rich content renderer implementations (map, chart — plugin territory)

---

## Bug Fixes (Post-Phase 8)

### Interaction Detection Fix — DONE
- [x] Fixed `<interaction>` tag detection failing when agent uses HTML attributes (e.g. `<interaction type="websearch">`)
- [x] Updated regex in `detector.mjs` to handle optional attributes: `/<interaction(?:\s[^>]*)?>[\s]*/g`
- [x] Added attribute-format fallback parser (`parseAttributeInteraction()`)
- [x] Updated `content-utils.mjs` strip/replace functions to match attribute-format tags
- [x] Updated `includes('<interaction>')` → `includes('<interaction')` in messages-stream, builtin.mjs
- [x] 8 new interaction detection tests (98 total in interactions-spec)
- [x] All 1630 tests passing

### UI Fixes — DONE
- [x] Moved avatar + username header INSIDE chat bubble (was outside/above)
- [x] Updated `_renderMessage()`, `_renderStreamingMessage()`, `_renderPhantomFrame()` in hero-chat.js
- [x] Added default user avatar (indigo SVG with initial) via `userAvatarUrl` getter
- [x] Updated shadow DOM styles (border-bottom separator, 22px round avatar, flex alignment)
- [x] Updated document-scope styles in hero-chat.html to match
- [x] Removed trailing ▼ chevron from Reflection (`<hml-thinking>`) in markup.js
- [x] Browser-verified: all 3 fixes working correctly

### Websearch Permissions Fix — DONE
- [x] Streaming websearch path was bypassing approval system — called `searchWeb()` directly
- [x] Added `checkApprovalRequired()` + `requestApproval()` integration in `messages-stream.mjs`
- [x] Now gates websearch execution on user approval (approve/deny/remember for session)
- [x] Denied searches send `interaction_result` with status 'denied' and error message

### Result Frame Cleanup — DONE
- [x] Successful RESULT frames now hidden (return empty string from `_renderResultFrame()`)
- [x] Failed RESULT frames still visible with error details
- [x] REQUEST frame already shows the action nicely — no need to duplicate with JSON blob

### User Avatar Fix — DONE
- [x] Avatar initial now derives from actual username (`GlobalState.user`) not "You"
- [x] User "wyatt" → "W", user "claude" → "C"
- [x] All 1672 tests passing

---

## S2: WebSocket Broadcast to All Channel Participants
> Status: **COMPLETE**

### What was done
- [x] Added `broadcastToSession(sessionId, message)` to `server/lib/websocket.mjs`
- [x] Looks up all user-type participants via `getParticipantsByType(sessionId, 'user')`
- [x] Converted ALL 22+ broadcast call sites from `broadcastToUser`/`broadcast` to `broadcastToSession`:
  - `server/lib/frames/broadcast.mjs` — createAndBroadcastFrame
  - `server/lib/assertions/` — thinking, progress, link, question, response, todo
  - `server/lib/abilities/` — approval, executor, question
  - `server/lib/compaction.mjs` — compaction complete broadcast
  - `server/lib/interactions/functions/prompt-update.mjs` — frame update broadcast
  - `server/routes/messages-stream.mjs` — streaming error broadcast
  - `server/lib/websocket.mjs` — interaction bus handler (session_id preferred, user_id fallback)
  - `server/lib/interactions/index.mjs` — connectToWebSocket signature updated
- [x] Removed `broadcast` alias export from websocket.mjs (dead code)
- [x] Changed `updateProgress` and `updateTodoItem` helper signatures: userId → sessionId
- [x] Wrote 18 tests: PARTY-005, BCAST-001, BCAST-002, INT-005, function contracts
- [x] All 1799 tests passing, 0 failures

---

## S4: Wire BEFORE_TOOL Hook into Interaction Detector
> Status: **COMPLETE**

### What was done
- [x] Wire BEFORE_TOOL/AFTER_TOOL hooks in `server/lib/interactions/detector.mjs`
- [x] Write 30 tests: PERM-001 thru PERM-006, GUARD-001/005/006, PLUGIN-001 thru PLUGIN-004, INT-001
- [x] Run full test suite — 1772 tests passing, 0 failures
- [x] Commit

---

## S7: Messages Stream Route Tests
> Status: **COMPLETE**

### What was done
- [x] Created `spec/routes/messages-stream-spec.mjs` — 33 integration tests
- [x] STREAM-001 thru STREAM-010: Input validation, SSE headers, round-trip, error handling
- [x] FRAME-001/002/003: Frame creation, token charges
- [x] MSG-001/002/003: Command interception, onstart flow, session updated_at
- [x] RENDER-003/004: HML element lifecycle (thinking, progress, todo)
- [x] GUARD-002: User interaction tag processing
- [x] Websearch element handling, session ownership enforcement
- [x] All 1767 tests passing

---

## S8: Comprehensive WebSocket Tests
> Status: **COMPLETE**

### What was done
- [x] Created `spec/lib/websocket-spec.mjs` — 47 tests
- [x] SEC-001: Authenticated userId passed to approval handler
- [x] SEC-002: Unauthenticated connection rejected (close code 4001)
- [x] SEC-003: Cross-user interaction prevention (reject wrong user, accept correct user)
- [x] SEC-004: Frame creation via WS rejected (no create_frame handler, unknown types ignored)
- [x] GUARD-008: Disconnect cleans up client tracking (register, remove, multiple connections)
- [x] Message handlers: question_answer, question_cancel, ability_question, approval, interaction
- [x] Interaction bus → WebSocket forwarding (per-connection handler, user targeting)
- [x] broadcastToUser delivery (single client, multi-client, cross-user isolation)
- [x] Error handling: malformed JSON, empty messages
- [x] All 1767 tests passing

---

## Test Runner Fix
> Status: **COMPLETE**

### What was done
- [x] Added `--test-force-exit` to `npm test` — prevents hanging from open DB/WS handles
- [x] Added `--test-timeout=30000` — safety net for individual test hangs
- [x] Root cause: messages-stream-spec imports real route modules (DB, websocket, timers)
- [x] Full suite: 1767 tests, 0 failures, ~12.5 seconds

---

## S6: Build Missing Test Helpers
> Status: **COMPLETE**

### Tasks
- [x] Create `spec/helpers/sse-mock.mjs` — Mock SSE response (write, setHeader, end, getEvents, getHeaders, parseSSE)
- [x] Create `spec/helpers/route-helpers.mjs` — Express route test harness (createMockRequest, createMockResponse, callRoute)
- [x] Create `spec/helpers/db-helpers.mjs` — Database fixture seeders (createTestDatabase, seedUser, seedAgent, seedSession, resetCounters)
- [x] Create `spec/helpers/helpers-spec.mjs` — 48 tests (16 SSE, 16 route, 16 database)
- [x] Run full test suite — 1684 tests passing, 0 failures

---

## S5: Self-Approval Prevention
> Status: **COMPLETE**

### What was done
- [x] Added `agentId` tracking to pending approvals in `approval.mjs` (from `context.agent?.id`)
- [x] Added self-approval check in `handleApprovalResponse` — blocks when `securityContext.agentId === pending.agentId`
- [x] Added `source_agent_id` field to interaction creation in `bus.mjs`
- [x] Added self-response check in `bus.respond()` — blocks when responding agent matches `source_agent_id`
- [x] Added `sourceAgentId` to interaction options in `detector.mjs`
- [x] Added `_addPendingApproval` test helper export
- [x] Wrote 10 tests: COORD-003, GUARD-007, edge cases (null agentId, empty context)
- [x] All tests passing

---

## X1: Rate Limiting
> Status: **COMPLETE**

### What was done
- [x] Created `server/middleware/rate-limit.mjs` — in-memory token-bucket rate limiter with sliding window
- [x] `POST /login` — 10/min per IP (auth.mjs)
- [x] `POST /auth/magic-link/request` — 5/hour per email (users.mjs)
- [x] `POST /me/api-keys` — 10/hour per user (users.mjs)
- [x] Global API — 100/min per IP (routes/index.mjs)
- [x] Exports: `rateLimit()`, `consume()`, `resetBucket()`, `resetAll()`, `stopCleanup()`
- [x] Wrote 17 tests: core consume, middleware, route wiring, edge cases
- [x] All tests passing
