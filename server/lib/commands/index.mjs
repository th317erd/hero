'use strict';

// ============================================================================
// Command System
// ============================================================================
// Server-side command execution engine.
// Intercepts user messages matching /command pattern and executes them
// without involving the AI agent.

import { getDatabase } from '../../database.mjs';
import { getStartupAbilities } from '../abilities/registry.mjs';
import { forceCompaction } from '../compaction.mjs';
import { setupSessionAgent } from '../messaging/session-setup.mjs';
import {
  createSystemMessageFrame,
  createAgentMessageFrame,
} from '../frames/broadcast.mjs';
import { loadSessionWithAgent } from '../participants/index.mjs';

// ============================================================================
// Command Pattern Matching
// ============================================================================

/**
 * Regular expression to match command patterns.
 * Matches: optional whitespace, /, then one or more word chars or underscores
 */
const COMMAND_PATTERN = /^\s*\/([\w_]+)/;

/**
 * Check if a message is a command.
 *
 * @param {string} message - The message to check
 * @returns {boolean} True if the message is a command
 */
export function isCommand(message) {
  if (!message || typeof message !== 'string')
    return false;

  return COMMAND_PATTERN.test(message);
}

/**
 * Parse a command string into name and args.
 *
 * @param {string} message - The command message
 * @returns {object|null} { name, args } or null if not a command
 */
export function parseCommand(message) {
  if (!message || typeof message !== 'string')
    return null;

  let match = message.match(COMMAND_PATTERN);
  if (!match)
    return null;

  let name = match[1].toLowerCase();
  // Get everything after the command name
  let afterCommand = message.slice(message.indexOf(match[0]) + match[0].length);
  let args = afterCommand.trim();

  return { name, args };
}

// ============================================================================
// Command Registry
// ============================================================================

/**
 * Built-in commands registry.
 * Each command has: name, description, handler(args, context)
 */
const BUILTIN_COMMANDS = new Map();

/**
 * Command aliases (e.g., update-usage -> update_usage)
 */
const COMMAND_ALIASES = new Map([
  ['update-usage', 'update_usage'],
]);

/**
 * Register a built-in command.
 */
function registerCommand(name, description, handler) {
  BUILTIN_COMMANDS.set(name, { name, description, handler });
}

/**
 * Get a command by name (with alias resolution).
 *
 * @param {string} name - Command name
 * @returns {object|null} Command object or null
 */
export function getCommand(name) {
  if (!name)
    return null;

  // Check aliases first
  let resolvedName = COMMAND_ALIASES.get(name) || name;

  return BUILTIN_COMMANDS.get(resolvedName) || null;
}

/**
 * Get all registered commands.
 *
 * @returns {Array} Array of command objects
 */
export function getAllCommands() {
  return Array.from(BUILTIN_COMMANDS.values());
}

// ============================================================================
// Command Execution
// ============================================================================

/**
 * Execute a command.
 *
 * @param {string} name - Command name
 * @param {string} args - Command arguments
 * @param {object} context - Execution context
 * @param {number} context.sessionId - Session ID
 * @param {number} context.userId - User ID
 * @param {object} context.session - Session object (optional)
 * @param {Buffer} context.dataKey - Data key for decryption (optional)
 * @param {object} context.db - Database instance (optional)
 * @returns {Promise<object>} { success, content?, error? }
 */
export async function executeCommand(name, args, context) {
  let command = getCommand(name);

  if (!command) {
    return {
      success: false,
      error:   `Unknown command: /${name}\nType /help for available commands.`,
    };
  }

  try {
    return await command.handler(args, context);
  } catch (error) {
    console.error(`[Commands] Error executing /${name}:`, error);
    return {
      success: false,
      error:   `Command failed: ${error.message}`,
    };
  }
}

// ============================================================================
// Built-in Command Handlers
// ============================================================================

// /help [filter]
registerCommand('help', 'Show available commands and help topics', async (args, context) => {
  let filter = args.trim().toLowerCase();
  let commands = getAllCommands();

  // Filter if provided
  if (filter) {
    commands = commands.filter((cmd) =>
      cmd.name.toLowerCase().includes(filter) ||
      cmd.description.toLowerCase().includes(filter)
    );
  }

  let text = '# Help\n\n';

  if (filter)
    text += `*Filtering by: \`${filter}\`*\n\n`;

  text += '## Commands\n\n';

  if (commands.length === 0) {
    text += `No commands found matching \`${filter}\`.\n`;
  } else {
    for (let cmd of commands) {
      text += `  /${cmd.name} - ${cmd.description}\n`;
    }
  }

  return { success: true, content: text };
});

// /session
registerCommand('session', 'Show current session information', async (args, context) => {
  if (!context.session && !context.sessionId) {
    return {
      success: false,
      error:   'No active session.',
    };
  }

  let session = context.session;

  // If we only have sessionId, try to load session info
  if (!session && context.sessionId && context.userId) {
    let db = context.db || getDatabase();
    session = db.prepare('SELECT id, name FROM sessions WHERE id = ? AND user_id = ?')
      .get(context.sessionId, context.userId);
  }

  if (!session) {
    return {
      success: false,
      error:   'Session not found.',
    };
  }

  let text = `**Current session:** ${session.name || 'Unnamed'}\n`;
  text += `**Session ID:** ${session.id}`;

  return { success: true, content: text };
});

// /start
registerCommand('start', 'Re-send startup instructions to the agent', async (args, context) => {
  if (!context.sessionId) {
    return {
      success: false,
      error:   'No active session. Please select or create a session first.',
    };
  }

  let startupAbilities = getStartupAbilities();
  let processAbilities = startupAbilities.filter((a) => a.type === 'process' && a.content);

  if (processAbilities.length === 0) {
    return {
      success: false,
      error:   'No startup abilities found.',
    };
  }

  let startupContent = processAbilities
    .map((a) => a.content)
    .join('\n\n---\n\n');

  // Return content to be sent to agent
  return {
    success:      true,
    sendToAgent:  true,
    agentContent: `[System Initialization - Refresh]\n\n${startupContent}`,
    content:      'Startup instructions sent to agent.',
  };
});

// /compact
registerCommand('compact', 'Compact conversation history into a summary', async (args, context) => {
  if (!context.sessionId) {
    return {
      success: false,
      error:   'No active session to compact.',
    };
  }

  if (!context.dataKey) {
    return {
      success: false,
      error:   'Missing authentication key. Please re-login and try again.',
    };
  }

  let db = context.db || getDatabase();

  // Get session with full agent info (needed to instantiate agent with API key)
  let session = loadSessionWithAgent(context.sessionId, context.userId, db);

  if (!session) {
    return {
      success: false,
      error:   'Session not found.',
    };
  }

  if (!session.agent_id) {
    return {
      success: false,
      error:   'Session has no agent configured.',
    };
  }

  try {
    // Create a real agent instance with API credentials
    let { agent } = setupSessionAgent({
      session,
      userId:  context.userId,
      dataKey: context.dataKey,
      content: '',
    });

    let result = await forceCompaction(context.sessionId, context.userId, agent);

    if (result.success) {
      return {
        success: true,
        content: `<b>Compaction complete</b><br><br><ul><li>Messages compacted: ${result.compactedCount || 0}</li><li>Summary length: ${result.summaryLength || 0} chars</li><li>Frame ID: ${result.frameId || 'N/A'}</li></ul>`,
      };
    } else {
      return {
        success: false,
        error:   `Compaction failed: ${result.reason || 'Unknown error'}`,
      };
    }
  } catch (error) {
    return {
      success: false,
      error:   `Compaction error: ${error.message}`,
    };
  }
});

// /reload
registerCommand('reload', 'Reload agent instructions without generating a response', async (args, context) => {
  if (!context.sessionId) {
    return {
      success: false,
      error:   'No active session. Please select or create a session first.',
    };
  }

  let startupAbilities = getStartupAbilities();
  let processAbilities = startupAbilities.filter((a) => a.type === 'process' && a.content);

  if (processAbilities.length === 0) {
    return {
      success: false,
      error:   'No startup abilities found.',
    };
  }

  let startupContent = processAbilities
    .map((a) => a.content)
    .join('\n\n---\n\n');

  // Store as hidden system message (agent can see this in context)
  createSystemMessageFrame({
    sessionId: context.sessionId,
    userId:    context.userId,
    content:   `[System Reload]\n\nYour instructions have been refreshed:\n\n${startupContent}`,
    hidden:    true,
  });

  // Create visible acknowledgment
  createAgentMessageFrame({
    sessionId:    context.sessionId,
    userId:       context.userId,
    agentId:      context.agentId || null,
    content:      '<p><em>System instructions have been refreshed.</em></p>',
    hidden:       false,
    skipSanitize: true,
  });

  return {
    success:    true,
    content:    null,  // No additional content needed - frame was already created
    noResponse: true,  // Signal that we don't need to create another frame
  };
});

// /stream [on|off]
registerCommand('stream', 'Toggle streaming mode (on/off)', async (args, context) => {
  let mode = args.trim().toLowerCase();

  // This command affects client-side state, so we return instructions
  if (mode === 'on' || mode === 'enable') {
    return {
      success:       true,
      content:       'Streaming mode enabled. Responses will appear progressively.',
      streamingMode: true,
    };
  } else if (mode === 'off' || mode === 'disable') {
    return {
      success:       true,
      content:       'Streaming mode disabled. Responses will appear after completion.',
      streamingMode: false,
    };
  } else {
    return {
      success: true,
      content: 'Usage:\n/stream on  - Enable streaming\n/stream off - Disable streaming',
    };
  }
});

// /update_usage <cost>
registerCommand('update_usage', 'Update usage tracker to match actual API cost', async (args, context) => {
  let input = args.trim();

  if (!input) {
    return {
      success: true,
      content: 'Usage: /update_usage <cost>\n\nProvide your current actual API cost (in dollars).\n\nExample: /update_usage 5.50\n\nThis will adjust the usage tracker to match your actual spend.',
    };
  }

  // Parse cost - remove $ if present
  let actualCost = parseFloat(input.replace(/^\$/, ''));

  if (isNaN(actualCost) || actualCost < 0) {
    return {
      success: false,
      error:   `Invalid cost: "${input}"\n\nPlease provide a number, e.g., /update_usage 5.50`,
    };
  }

  // Get current usage
  let db = context.db || getDatabase();

  // Calculate current tracked cost from token_charges
  let currentUsage = db.prepare(`
    SELECT COALESCE(SUM(cost_cents), 0) as total_cents
    FROM token_charges
    WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)
  `).get(context.userId);

  let currentCost     = (currentUsage?.total_cents || 0) / 100;
  let actualCostCents = Math.round(actualCost * 100);
  let correctionCents = actualCostCents - (currentUsage?.total_cents || 0);

  // Insert correction charge
  db.prepare(`
    INSERT INTO token_charges (agent_id, session_id, message_id, input_tokens, output_tokens, cost_cents, charge_type)
    VALUES (NULL, ?, NULL, 0, 0, ?, 'correction')
  `).run(context.sessionId, correctionCents);

  let text = `Usage correction applied.\n\n`;
  text += `**Previous:** $${currentCost.toFixed(2)}\n`;
  text += `**New:** $${actualCost.toFixed(2)}\n`;

  if (correctionCents !== 0) {
    let sign = (correctionCents >= 0) ? '+' : '';
    text += `**Adjustment:** ${sign}$${(correctionCents / 100).toFixed(2)}`;
  } else {
    text += `No adjustment needed - tracking is accurate.`;
  }

  return { success: true, content: text };
});

// /ability [list|create|edit|delete]
registerCommand('ability', 'Manage abilities (list, create, edit, delete)', async (args, context) => {
  let parts      = args.trim().split(/\s+/);
  let subcommand = parts[0]?.toLowerCase() || 'list';
  let name       = parts.slice(1).join(' ');

  let db = context.db || getDatabase();

  switch (subcommand) {
    case 'list': {
      // Get abilities from database
      let abilities = db.prepare(`
        SELECT id, name, description, type, danger_level, source
        FROM abilities
        WHERE user_id = ? OR source = 'system' OR source = 'builtin'
        ORDER BY source, name
      `).all(context.userId);

      let text = '# Abilities\n\n';

      let processes = abilities.filter((a) => a.type === 'process');
      let functions = abilities.filter((a) => a.type === 'function');

      if (functions.length > 0) {
        text += '## Functions\n';
        for (let ability of functions) {
          let danger = (ability.danger_level !== 'safe') ? ` [${ability.danger_level}]` : '';
          text += `  **${ability.name}**${danger} - ${ability.description || 'No description'} (${ability.source})\n`;
        }
        text += '\n';
      }

      if (processes.length > 0) {
        text += '## Process Abilities\n';
        for (let ability of processes) {
          let danger = (ability.danger_level !== 'safe') ? ` [${ability.danger_level}]` : '';
          text += `  **${ability.name}**${danger} - ${ability.description || 'No description'} (${ability.source})\n`;
        }
      }

      if (abilities.length === 0)
        text += 'No abilities configured.\n';

      text += '\nCommands: /ability create, /ability edit <name>, /ability delete <name>';

      return { success: true, content: text };
    }

    case 'create':
    case 'new':
      return {
        success:    true,
        content:    'To create an ability, use the Abilities modal in the UI.',
        showModal:  'ability',
      };

    case 'edit':
      if (!name) {
        return {
          success: false,
          error:   'Usage: /ability edit <name>',
        };
      }
      return {
        success:     true,
        content:     `To edit ability "${name}", use the Abilities modal in the UI.`,
        showModal:   'ability',
        abilityName: name,
      };

    case 'delete':
      if (!name) {
        return {
          success: false,
          error:   'Usage: /ability delete <name>',
        };
      }

      // Find ability
      let ability = db.prepare(`
        SELECT id FROM abilities
        WHERE user_id = ? AND name = ? AND source = 'user'
      `).get(context.userId, name);

      if (!ability) {
        return {
          success: false,
          error:   `Ability "${name}" not found or cannot be deleted (only user abilities can be deleted).`,
        };
      }

      db.prepare('DELETE FROM abilities WHERE id = ?').run(ability.id);

      return {
        success: true,
        content: `Ability "${name}" deleted.`,
      };

    default:
      return {
        success: false,
        error:   `Unknown subcommand: ${subcommand}\n\nUsage: /ability [list|create|edit|delete]`,
      };
  }
});

export default {
  isCommand,
  parseCommand,
  getCommand,
  getAllCommands,
  executeCommand,
};
