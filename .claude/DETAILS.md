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

## Credentials & Config

- JWT tokens stored in localStorage on frontend
- API keys encrypted in database (`encrypted_api_key` column)
- Config directory: `~/.config/hero/`
- Test login: `claude` / `claude123`
