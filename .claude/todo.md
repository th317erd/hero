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

## Pending
[ ] Debug "Show hidden messages" checkbox - debug logging added, needs user testing to verify behavior
[ ] Add token scalar setting for adjusting cost calculation ratio (mentioned in update_usage requirements)

## Recently Completed (2026-02-06)
[x] Token charges system - records every API call with agent_id, session_id, message_id, cost
[x] 3-line spend display: Global Spend (all agents), Service Spend (same API key), Session Spend
[x] Private messages column - for user-only messages not sent to agent
[x] Compacting memory - improved prompt to capture comprehensive context AND generate TODO lists
[x] Add "Chevron Down" button to jump to bottom of chat - floats at bottom-right, auto-hides when near bottom
[x] Add `/update_usage <cost>` command - stores corrections in database, adjusts tracking to match actual spend
[x] Unit tests for token charges system - 30 tests covering cost calculation, spend queries, corrections
[x] Unified test runner - converted all spec files from Jest to Node.js built-in test runner (177 tests total)

## Architecture Notes
- **Abilities** = verbal "guides" for the agent, applied when the agent feels they should
- **Sources**: builtin, system, user, plugin
- **Hidden messages**: `hidden=1` in messages table, filtered in frontend but sent to AI
- **Startup abilities**: `_onstart_*` pattern, `__onstart_` runs first (double underscore = higher priority)
