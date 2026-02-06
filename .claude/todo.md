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
[ ] Compacting memory doesn't seem to work too well.

## Architecture Notes
- **Abilities** = verbal "guides" for the agent, applied when the agent feels they should
- **Sources**: builtin, system, user, plugin
- **Hidden messages**: `hidden=1` in messages table, filtered in frontend but sent to AI
- **Startup abilities**: `_onstart_*` pattern, `__onstart_` runs first (double underscore = higher priority)

## Current Issue
User reported slowness with navigation. Likely needs server restart for new code/migration.
