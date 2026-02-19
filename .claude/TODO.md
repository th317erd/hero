# Hero V1 Implementation

## Phase 0: Complete Frame Migration
> Status: VERIFYING — assessing completion state

- [ ] Audit legacy `new_message`/`message_append` emissions — confirm dead or kill them
- [ ] Lock in compiled frame payload shapes as formal contracts (type definitions)
- [ ] Write tests verifying no legacy event paths remain
- [ ] Verify interaction frames (request/result) work end-to-end in streaming route

## Phase 1: Multi-party Sessions
> Status: PENDING — blocked by Phase 0
> Risk: HIGH — DB schema change cascades through every route

- [ ] Create `session_participants` table migration
- [ ] Populate from existing `agent_id` + `user_id` data
- [ ] Make `agent_id` nullable on sessions (backwards compat)
- [ ] Create participant CRUD helpers (add, remove, list, update role)
- [ ] Rewrite `sessions.mjs` routes to use participants
- [ ] Rewrite `messages-stream.mjs` to load agent from participants
- [ ] Rewrite `messages.mjs` to load agent from participants
- [ ] Rewrite `pipeline/context.mjs` to read from participants
- [ ] Rewrite `session-setup.mjs` to load from participants
- [ ] Update WebSocket broadcast to target all session participants
- [ ] Update session creation modal for multi-agent selection
- [ ] Add participant list sidebar in chat view
- [ ] Add `@mention` autocomplete from participant list
- [ ] Write unit tests for participant CRUD
- [ ] Write integration tests for multi-participant sessions
- [ ] Write E2E tests

## Phase 2: Permissions System
> Status: PENDING — blocked by Phase 1
> Risk: MEDIUM-HIGH — security-critical

- [ ] Create `permission_rules` table migration
- [ ] Build permission engine (`server/lib/permissions/`)
- [ ] Implement `evaluate(subject, resource, context)` → allow/deny/prompt
- [ ] Implement specificity-based resolution (most specific wins)
- [ ] Wire into BEFORE_COMMAND/BEFORE_TOOL hooks
- [ ] Integrate with existing `abilities/approval.mjs`
- [ ] Build permission prompt UX (`<hml-prompt>`)
- [ ] Implement meta-permissions (who can modify rules)
- [ ] Structured command arguments for all commands
- [ ] Write exhaustive unit tests (100% branch coverage target)
- [ ] Write integration tests
- [ ] Write property-based tests for deterministic resolution

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
