'use strict';

import { Router } from 'express';
import { getDatabase } from '../database.mjs';
import { requireAuth } from '../middleware/auth.mjs';
import { getAllAssertionTypes } from '../lib/assertions/index.mjs';
import { getAbilitiesBySource } from '../lib/abilities/registry.mjs';
import { getAllSystemMethods } from '../lib/interactions/functions/system.mjs';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/help
 * Get comprehensive help data including handlers, assertions, and abilities.
 */
router.get('/', (req, res) => {
  let db = getDatabase();

  // Get all registered system methods (from InteractionBus)
  let systemMethods = getAllSystemMethods();

  // Get all assertion types with descriptions
  let assertions = getAllAssertionTypes();

  // Get system abilities from registry
  let systemAbilities = getAbilitiesBySource('system');
  let builtinAbilities = getAbilitiesBySource('builtin');
  let allSystemAbilities = [...systemAbilities, ...builtinAbilities];

  // Get user abilities from database
  let userAbilities = db.prepare(`
    SELECT id, name, description
    FROM abilities
    WHERE user_id = ?
    ORDER BY name
  `).all(req.user.id);

  // Get user commands
  let userCommands = db.prepare(`
    SELECT id, name, description
    FROM commands
    WHERE user_id = ?
    ORDER BY name
  `).all(req.user.id);

  return res.json({
    systemMethods: systemMethods,
    assertions:    assertions,
    // Keep 'processes' key for backwards compatibility with frontend
    processes: {
      system: allSystemAbilities.map((a) => ({
        name:        a.name,
        description: a.description,
      })),
      user: userAbilities.map((a) => ({
        id:          a.id,
        name:        a.name,
        description: a.description,
      })),
    },
    commands: {
      builtin: [
        { name: 'help',    description: 'Show this help information' },
        { name: 'clear',   description: 'Clear the current chat' },
        { name: 'session', description: 'Show session info or switch sessions' },
        { name: 'archive', description: 'Archive the current session' },
        { name: 'stream',  description: 'Toggle streaming mode (on/off)' },
        { name: 'ability', description: 'Manage abilities (create/list/view/delete)' },
      ],
      user: userCommands.map((c) => ({
        id:          c.id,
        name:        c.name,
        description: c.description,
      })),
    },
  });
});

export default router;
