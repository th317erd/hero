# Hero Codebase Cleanup Plan

**Created:** 2026-02-15
**Status:** Analysis Complete - Ready for TDD Execution

---

## Executive Summary

After analyzing the codebase, I've identified **3 categories** of issues:

1. **Known Bugs** (from STATUS.md) - 3 critical HML prompt issues
2. **Code Smells** - Architectural patterns that cause fragility
3. **Missing Tests** - Areas lacking test coverage

---

## 1. Known Bugs (Priority: HIGH)

### Bug 1.1: AI Sends Duplicate `update_prompt` Interactions

**Symptom:** When user submits a prompt answer, the AI echoes the system's interaction.

**Flow Analysis:**
```
1. User answers hml-prompt via inline input
2. hml-prompt.js dispatches 'prompt-submit' event
3. app.js catches event, calls submitUserPromptAnswer()
4. submitUserPromptAnswer() creates user message WITH <interaction> tag
5. Server processes message, executes interaction, updates frame ✓
6. AI responds to conversation
7. AI sees prompt_response_handler conditional ability (BUG!)
8. AI sends its OWN update_prompt interaction (DUPLICATE!)
9. Duplicate fails with "Prompt not found" - already updated
```

**Root Cause Analysis:**

The `prompt_response_handler.matchCondition()` in `builtin.mjs` checks:
```javascript
if (userMessage.includes('<interaction>')) {
  return { matches: false };
}
```

This SHOULD prevent the conditional from triggering. Possible issues:
- The check happens BEFORE interactions are processed, so `getUnansweredPrompts()` still returns prompts
- The AI context includes the conditional instructions from a PREVIOUS check
- Race condition between interaction processing and conditional check

**Files Involved:**
- `server/lib/abilities/loaders/builtin.mjs:61-87` - matchCondition
- `server/lib/abilities/conditional.mjs:24-67` - checkConditionalAbilities
- `server/routes/messages-stream.mjs:142-159` - replaceInteractionTagsWithNote (attempted fix)
- `public/js/app.js:1048-1076` - submitUserPromptAnswer

**Proposed Fix:**
1. After interaction execution, update the frame BEFORE the AI responds
2. The `getUnansweredPrompts()` will then correctly return empty
3. OR: Pass a flag indicating "this message already processed an interaction"

**Test Strategy:**
```javascript
describe('Duplicate update_prompt prevention', () => {
  it('should not trigger prompt_response_handler when message has interaction', async () => {
    // Setup: Create message with <interaction> tag
    // Assert: matchCondition returns { matches: false }
  });

  it('should not find prompt as unanswered after frame update', async () => {
    // Setup: Update frame via PromptUpdateFunction
    // Assert: getUnansweredPrompts returns empty
  });
});
```

---

### Bug 1.2: System Interaction Results Displayed in Chat

**Symptom:** The `update_prompt` interaction result (including errors) appears in chat.

**Flow Analysis:**
```
1. Interaction executes on server
2. Server sends interaction_result SSE event
3. streaming.js onInteractionResult handler fires
4. updateInteractionBanner() tries to update banner
5. If no banner exists (silent interaction), result still gets displayed somewhere
```

**Root Cause Analysis:**

Looking at `streaming.js:99-106`:
```javascript
onElementStart: (data) => {
  // Skip elements that shouldn't render as streaming elements:
  // - interaction: System communication between agent and server
  if (data.type === 'interaction') {
    return;
  }
  // ...renders element
}
```

But `onInteractionResult` at line 235 doesn't have this guard - it tries to update banners for ALL interactions, even those without banners.

**Files Involved:**
- `public/js/streaming.js:235-255` - onInteractionResult
- `public/js/streaming.js:855-887` - appendInteractionBanner

**Proposed Fix:**
1. In `onInteractionResult`, check if `pendingInteractions` has this ID
2. If not (silent interaction), don't try to update/display anything
3. Add explicit `silent: true` flag for functions that should never show UI

**Test Strategy:**
```javascript
describe('Silent interaction handling', () => {
  it('should not display results for interactions without banners', () => {
    // Setup: Trigger update_prompt interaction (no banner)
    // Assert: No banner element created in DOM
  });

  it('should display results for interactions with banners', () => {
    // Setup: Trigger websearch interaction (has banner)
    // Assert: Banner element shows in DOM
  });
});
```

---

### Bug 1.3: Prompt May Not Turn Green Immediately

**Symptom:** After answering, prompt doesn't turn green until page reload.

**Flow Analysis:**
```
1. User answers prompt
2. hml-prompt._submitAnswer() sets answered attribute ✓
3. hml-prompt.render() re-renders as green ✓
4. submitUserPromptAnswer() calls updatePromptInState()
5. updatePromptInState() tries to find message by ID
6. If ID mismatch (string vs number) → state not updated
7. Later renderMessages() recreates DOM from stale state
8. Prompt reverts to unanswered state (BUG!)
```

**Root Cause Analysis:**

In `app.js:1085`:
```javascript
let message = state.messages.find((m) => m.id === messageId || m.id === String(messageId));
```

The issue is `messageId` comes from `data-message-id` attribute, which might be:
- The frame ID (from server)
- An optimistic ID like "streaming-12345"
- A string when the state has number IDs

Additionally, after `finalizeStreamingMessage()` the message gets a `persistedMessageID` but the DOM element's `data-message-id` might still have the old streaming ID.

**Files Involved:**
- `public/js/app.js:1081-1149` - updatePromptInState
- `public/js/components/hml-prompt/hml-prompt.js:685-716` - _submitAnswer
- `public/js/streaming.js:628-751` - finalizeStreamingMessage

**Proposed Fix:**
1. Update `data-message-id` attribute when `persistedMessageID` arrives
2. Use more robust ID matching (parse both as numbers, compare)
3. Add logging to track ID mismatches

**Test Strategy:**
```javascript
describe('Prompt state synchronization', () => {
  it('should update state.messages when prompt is answered', () => {
    // Setup: Add message to state, dispatch prompt-submit
    // Assert: state.messages[n].content contains answered="true"
  });

  it('should handle string/number ID mismatch', () => {
    // Setup: state has id as number, event has id as string
    // Assert: updatePromptInState still finds and updates message
  });
});
```

---

## 2. Code Smells (Priority: MEDIUM)

### Smell 2.1: Dual State Management

**Issue:** State exists in multiple places that can get out of sync.

**Locations:**
1. `state.messages` (app.js legacy array)
2. `GlobalState.heroFrames` (Mythix DynamicProperty)
3. `session-frames-provider.frames` (component state)
4. Database `frames` table (source of truth)

**Symptom:** Changes in one don't propagate to others.

**Proposed Fix:**
- Make frames the ONLY state
- Remove `state.messages` entirely
- All components read from frames provider

---

### Smell 2.2: Multiple Render Triggers

**Issue:** Too many things trigger re-renders, causing race conditions.

**Examples:**
- `renderMessages()` - full re-render
- `renderDebounced()` - debounced but still full
- `updateStreamingContent()` - partial update
- WebSocket `frame_update` events - another trigger

**Symptom:** Render loop detection code (`_renderCount > 10`).

**Proposed Fix:**
- Single render loop with dirty checking
- Batch updates before render
- Remove debounce in favor of RAF batching

---

### Smell 2.3: Event Handler Cascade Guards

**Issue:** Multiple `_handlingEnter`, `e._hmlHandled` guards scattered everywhere.

**Files with guards:**
- `hml-prompt.js:420-431` - input._handlingEnter
- `hml-prompt.js:488-495` - submit._handlingClick
- `app.js:1190-1192` - event.stopImmediatePropagation()

**Root Cause:** Events bubble through Shadow DOM and multiple handlers catch them.

**Proposed Fix:**
- Use single event handler at document level
- Events should be "consumed" not "guarded"
- Consider event delegation pattern

---

### Smell 2.4: Mixed Content Formats

**Issue:** Content can be string OR Claude API array format, requiring constant checking.

**Pattern repeated in:**
- `prompt-update.mjs:120-143`
- `app.js:1092-1111`
- `streaming.js:various`
- `hero-chat.js:various`

**Proposed Fix:**
- Normalize content to single format at boundaries
- Create `normalizeContent()` utility
- Apply at frame creation time

---

## 3. Missing Test Coverage (Priority: HIGH for bugs, MEDIUM for smells)

### Current Coverage
- 547 tests passing
- Good coverage for: encryption, config, agents, plugins, usage, frames

### Gaps Identified

| Area | Current Tests | Needed |
|------|---------------|--------|
| hml-prompt component | 18 (logic only) | DOM interaction tests |
| Prompt state sync | 0 | Full flow tests |
| Interaction dedup | 0 | End-to-end tests |
| Conditional abilities | 0 | matchCondition tests |
| Streaming finalization | 0 | State consistency tests |
| Frame compilation | 36 | Good coverage ✓ |

---

## 4. Execution Plan

### Phase A: Write Tests for Known Bugs (1 hour)

```bash
spec/
├── integration/
│   ├── prompt-flow-spec.mjs      # Full prompt answer flow
│   └── interaction-dedup-spec.mjs # Duplicate interaction prevention
├── lib/
│   └── abilities/
│       └── conditional-spec.mjs  # matchCondition logic
└── components/
    └── hml-prompt-dom-spec.mjs   # DOM interaction tests
```

### Phase B: Fix Bugs with TDD (2-3 hours)

1. **Bug 1.1:** Fix duplicate update_prompt
   - Write failing test
   - Fix `getUnansweredPrompts()` timing
   - Verify test passes

2. **Bug 1.2:** Fix interaction result display
   - Write failing test
   - Add silent interaction guard
   - Verify test passes

3. **Bug 1.3:** Fix green state sync
   - Write failing test
   - Fix ID matching in `updatePromptInState()`
   - Verify test passes

### Phase C: Address Code Smells (Future)

Lower priority - document and schedule for later:
- Smell 2.1: Requires architectural change
- Smell 2.2: Requires render system refactor
- Smell 2.3: Can do incrementally
- Smell 2.4: Can do with utility function

---

## 5. Definition of Done

- [ ] All 3 known bugs have failing tests
- [ ] All 3 bugs are fixed
- [ ] All tests pass (547 + new tests)
- [ ] Manual verification of prompt flow
- [ ] TODO.md updated with completion status

---

## Notes

- Test credentials: `claude` / `claude123`
- Database: `~/.config/hero/hero.db`
- Run tests: `npm test`
- Run specific: `node --test spec/path/to/spec.mjs`
