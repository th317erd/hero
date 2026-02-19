# Hero V1 Implementation

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
> Status: **ENGINE COMPLETE** — prompt UX and advanced features pending
> Risk: MEDIUM-HIGH — security-critical

### Engine (complete)
- [x] Create `permission_rules` table migration (019)
- [x] Build permission engine (`server/lib/permissions/index.mjs`)
- [x] Implement `evaluate(subject, resource, context)` → allow/deny/prompt
- [x] Implement specificity-based resolution (most specific wins, deny beats allow)
- [x] Wire into BEFORE_COMMAND hook via command-handler.mjs
- [x] Wire BEFORE_COMMAND/AFTER_COMMAND plugin hooks
- [x] Write exhaustive unit tests (65 tests — CRUD, specificity, scope, conditions, determinism)
- [x] Write integration tests (7 tests — command-handler permission flow)
- [x] Write property-based tests for deterministic resolution
- [x] All 1314 tests passing

### Pending
- [ ] Integrate with existing `abilities/approval.mjs` (prompt action → approval flow)
- [ ] Wire BEFORE_TOOL hook into interaction detector
- [ ] Build permission prompt UX (`<hml-prompt>`)
- [ ] Implement meta-permissions (who can modify rules)
- [ ] Structured command arguments for all commands
- [ ] Permission management API routes (CRUD for rules)

## Phase 3: Agent Roles & Coordination
> Status: PENDING — blocked by Phase 1 + 2

- [ ] Implement coordinator/member roles on session_participants
- [ ] Build inter-agent messaging (async, via frames)
- [ ] Add command interaction type to detector
- [ ] Implement recursion depth enforcement (max 10 exchanges)
- [ ] Build coordinator context vs member context
- [ ] Tests for role assignment, routing, loop detection

## Phase 4: Commands + Plugin Hardening
> Status: PENDING — blocked by Phase 2

- [ ] New commands: /participants, /invite, /kick, /history, /export
- [ ] Plugin hot-reload (fs.watch + unload/load)
- [ ] Plugin dependency declaration and resolution
- [ ] npm package plugin support
- [ ] Internal plugins directory (`server/plugins/`)
- [ ] Formalize plugin API shape
- [ ] Tests for all

## Phase 5: HML Forms + Infinite Scroll
> Status: PENDING — can start alongside Phase 3/4

- [ ] Group prompts per message with Submit/Ignore
- [ ] Batch submission for multiple prompts
- [ ] Paginated frames API (`GET /frames?before=<ts>&limit=50`)
- [ ] Client infinite scroll on scroll-to-top
- [ ] Cross-session search endpoint
- [ ] Tests

## Phase 6: Auth Enhancement + User Settings
> Status: PENDING — blocked by Phase 2

- [ ] Magic link token table + endpoints (stubbed email)
- [ ] JWT API keys table + endpoints
- [ ] Auth middleware: accept Bearer API keys
- [ ] User settings UI component (profile, account, API keys, permissions, billing)
- [ ] Tests

## Phase 7: Server-Authoritative Hardening
> Status: PENDING — blocked by Phases 0-3

- [ ] Audit all approval response paths
- [ ] Frame creation server-only enforcement
- [ ] sender_id enforcement in bus.mjs
- [ ] Approval frame command hash + replay prevention
- [ ] Chained command permissions UX
- [ ] Security tests

## Phase 8: Polish & Future Features
> Status: PENDING — independent

- [ ] File uploads (drag-and-drop)
- [ ] Agent avatars
- [ ] Rich content extension points
- [ ] Message visibility / screenshots (plugin)
