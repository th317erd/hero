# Hero Project Todo

## Testing & Verification - COMPLETED (2026-02-12)

### All Core CRUD Tests Passed
- [x] Successfully chat with the agent in a session
- [x] Test hml-prompt with EVERY input type (all 8 types working)
  - Fixed: hero-chat now triggers render on hml-prompt elements after innerHTML
  - Fixed: Smart quotes (char 8220/8221) converted to straight quotes for JSON parsing
- [x] Verify interaction frames system is working
  - Prompt submissions dispatch events and create interaction messages
- [x] Add Agent (with fake API key) - PASSED
- [x] Delete Agent - PASSED (after FK fix)
- [x] Add Ability - PASSED
- [x] Delete Ability - PASSED
- [x] Add Session - PASSED
- [x] Archive Session - API works, UI click needs investigation

### Bugs Fixed During Testing
- [x] Fix token_charges FK constraint bug
  - Added migration 017_fix_token_charges_fk
  - Removed orphaned FK reference to dropped messages table
- [x] Fix hml-prompt rendering in shadow DOM
- [x] Fix smart quotes JSON parsing

### Known Issues (Minor)
- Session archive button click doesn't trigger properly via Puppeteer
  - API endpoint works correctly
  - May be event binding issue in hero-sessions-list component
- Show/Hide archived toggle not fully tested due to auth token state

---

## Deferred Work

### Mythix UI Component Migration
The component migration work is paused. Current state:
- Several component directories created but incomplete
- See git status for `??` untracked directories
- Resume after current testing task is complete

### Interaction Frames
- [ ] Phase 4: WebSocket protocol
- [ ] Phase 5: Interactions & Commands

### Other Deferred
- [ ] Debug "Show hidden messages" checkbox
- [ ] Token scalar setting for cost calculation
- [ ] Investigate session archive button event binding

---

## Notes
- Test credentials: `claude` / `claude123`
- Database: `~/.config/hero/hero.db`
- Use Puppeteer MCP for visual testing
