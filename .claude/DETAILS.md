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

### Pending
- Interaction Frames Phase 4 (WebSocket protocol) and Phase 5 (Interactions & Commands)
- Mythix UI component migration (paused)
