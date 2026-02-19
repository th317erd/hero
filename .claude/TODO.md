# Hero Project Todo

## COMPLETED: Agent Reflection Separation (2026-02-18)

- [x] Update: `server/lib/processes/__onstart_.md` — instruct agent to use `<hml-thinking title="Reflection">` for ALL internal reasoning
- [x] Fix: `markup.js` — change `<details>` to collapsed by default (remove `open` attribute)
- [x] Fix: `messages.mjs` — extract text from Claude API content block arrays (pre-existing bug)
- [x] Verify: E2E test with real agent — reflection wraps in collapsible section, collapsed by default

### Future (NOT now)
- Lazy-load pre-compact messages on scroll-up
- Extended thinking API integration

---

## COMPLETED: Compact Frame Display + /compact Command Fix (2026-02-18)

- [x] Write tests: compaction snapshot population (`spec/lib/compaction-spec.mjs`) — 12 tests
- [x] Implement: `session-frames-provider.js` — include compact frames in getVisibleFrames
- [x] Implement: `hero-chat.js` — add `_renderCompactFrame()` for summary card rendering
- [x] Implement: `hero-chat.js` — CSS for compact summary card
- [x] Implement: `compaction.mjs` — populate snapshot with compiled message payloads
- [x] Implement: `api.js` — framesToMessages marks compact frames visible with context
- [x] Fix: `/compact` command — `agent.sendMessage is not a function`
  - Thread `dataKey` from auth middleware through command-handler to command context
  - Use `setupSessionAgent()` to create real agent instance with API credentials
  - Files: `commands/index.mjs`, `command-handler.mjs`, `messages-stream.mjs`, `messages.mjs`
- [x] Verify: all 1178 tests pass
- [x] Verify: E2E test — compact frame renders as collapsible summary card in browser
- [x] Verify: E2E test — `/compact` command creates compact frame with AI-generated summary

## COMPLETED: Scroll Fix During Streaming (2026-02-18)

- [x] Root cause: global `scrollToBottom()` called `heroChat.forceScrollToBottom()` (resets intent)
- [x] Fix: global `scrollToBottom()` now calls `heroChat.scrollToBottom()` (respects intent)
- [x] Fix: global `forceScrollToBottom()` now properly calls `heroChat.forceScrollToBottom()`
- [x] File: `public/js/approvals.js` lines 358-372
- [x] All 1166 tests pass

## COMPLETED: hml-prompt Persistence + Message Display Fix (2026-02-18)

- [x] Fix `fromCompact` parameter check in `server/routes/frames.mjs` (truthy, not `=== 'true'`)
- [x] Fix GlobalState → window.state reverse-sync in `public/js/components/index.js`
- [x] Fix race condition in `session-frames-provider.js` `_loadSession()`
- [x] Auto-assign IDs to hml-prompt tags in `server/lib/frames/broadcast.mjs`
- [x] Question-based fallback matching in `server/lib/interactions/functions/prompt-update.mjs`
- [x] All 1166 tests pass, E2E verified

## COMPLETED: Previous Work

(See git history for full details)
- State Consolidation + Server Extraction (2026-02-17)
- Codebase Hardening & Cleanup (2026-02-17)
- Server-Side Command Engine (2026-02-17)
- Deterministic Frame-Based UI System (2026-02-17)
- Markdown → HTML Migration (2026-02-16)
