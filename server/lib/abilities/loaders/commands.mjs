'use strict';

// ============================================================================
// Command Abilities Loader
// ============================================================================
// Registers system commands as abilities with "Ask Always" permission policy.
// These commands can be invoked by the AI agent but always require user approval.

import { registerAbility } from '../registry.mjs';
import { getDatabase } from '../../../database.mjs';
import { encryptWithKey, decryptWithKey } from '../../../encryption.mjs';

/**
 * Load all command abilities.
 * Commands are registered with autoApprovePolicy: 'never' (Ask Always).
 *
 * @returns {number} Number of command abilities loaded
 */
export function loadCommandAbilities() {
  let count = 0;

  // /ability command - Create/manage abilities
  registerAbility({
    name:        'command_ability',
    type:        'function',
    source:      'builtin',
    description: 'Create, edit, or delete abilities (Ask Always)',
    category:    'commands',
    tags:        ['command', 'ability', 'management'],
    permissions: {
      autoApprove:       false,
      autoApprovePolicy: 'never',  // Ask Always
      dangerLevel:       'moderate',
    },
    inputSchema: {
      type:       'object',
      properties: {
        action: {
          type:        'string',
          enum:        ['create', 'edit', 'delete', 'list'],
          description: 'Action to perform',
        },
        name: {
          type:        'string',
          description: 'Ability name',
        },
        description: {
          type:        'string',
          description: 'Ability description',
        },
        content: {
          type:        'string',
          description: 'Ability content (markdown instructions)',
        },
      },
      required: ['action'],
    },
    execute: executeAbilityCommand,
  });
  count++;

  // /session command - Create/manage sessions
  registerAbility({
    name:        'command_session',
    type:        'function',
    source:      'builtin',
    description: 'Create, archive, or switch sessions (Ask Always)',
    category:    'commands',
    tags:        ['command', 'session', 'management'],
    permissions: {
      autoApprove:       false,
      autoApprovePolicy: 'never',  // Ask Always
      dangerLevel:       'moderate',
    },
    inputSchema: {
      type:       'object',
      properties: {
        action: {
          type:        'string',
          enum:        ['create', 'archive', 'unarchive', 'list', 'spawn'],
          description: 'Action to perform',
        },
        name: {
          type:        'string',
          description: 'Session name',
        },
        agentId: {
          type:        'integer',
          description: 'Agent ID for new session',
        },
        sessionId: {
          type:        'integer',
          description: 'Session ID for archive/unarchive',
        },
        systemPrompt: {
          type:        'string',
          description: 'System prompt for new session',
        },
        status: {
          type:        'string',
          description: 'Session status (for spawn: "agent")',
        },
      },
      required: ['action'],
    },
    execute: executeSessionCommand,
  });
  count++;

  // /agent command - Create/manage agents
  registerAbility({
    name:        'command_agent',
    type:        'function',
    source:      'builtin',
    description: 'Create or configure AI agents (Ask Always)',
    category:    'commands',
    tags:        ['command', 'agent', 'management'],
    permissions: {
      autoApprove:       false,
      autoApprovePolicy: 'never',  // Ask Always
      dangerLevel:       'dangerous',  // Involves API keys
    },
    inputSchema: {
      type:       'object',
      properties: {
        action: {
          type:        'string',
          enum:        ['create', 'list', 'delete', 'configure'],
          description: 'Action to perform',
        },
        name: {
          type:        'string',
          description: 'Agent name',
        },
        type: {
          type:        'string',
          enum:        ['claude', 'openai'],
          description: 'Agent type',
        },
        agentId: {
          type:        'integer',
          description: 'Agent ID for configure/delete',
        },
        config: {
          type:        'object',
          description: 'Agent configuration',
        },
      },
      required: ['action'],
    },
    execute: executeAgentCommand,
  });
  count++;

  console.log(`Loaded ${count} command abilities`);
  return count;
}

/**
 * Execute the /ability command.
 */
async function executeAbilityCommand(params, context) {
  let { action, name, description, content } = params;
  let db = getDatabase();

  switch (action) {
    case 'create': {
      if (!name || !content)
        return { success: false, error: 'Name and content are required' };

      // Validate name format
      if (!/^[a-z0-9_]+$/.test(name))
        return { success: false, error: 'Name must contain only lowercase letters, numbers, and underscores' };

      // Check for duplicate
      let existing = db.prepare('SELECT id FROM processes WHERE user_id = ? AND name = ?').get(context.userId, name);
      if (existing)
        return { success: false, error: `Ability "${name}" already exists` };

      // Encrypt and store
      let encryptedContent = encryptWithKey(content, context.dataKey);
      let result = db.prepare(`
        INSERT INTO processes (user_id, name, description, encrypted_content)
        VALUES (?, ?, ?, ?)
      `).run(context.userId, name, description || null, encryptedContent);

      return {
        success: true,
        message: `Created ability "${name}"`,
        abilityId: result.lastInsertRowid,
      };
    }

    case 'edit': {
      if (!name)
        return { success: false, error: 'Name is required' };

      let ability = db.prepare('SELECT id FROM processes WHERE user_id = ? AND name = ?').get(context.userId, name);
      if (!ability)
        return { success: false, error: `Ability "${name}" not found` };

      let updates = [];
      let values  = [];

      if (description !== undefined) {
        updates.push('description = ?');
        values.push(description || null);
      }

      if (content !== undefined) {
        updates.push('encrypted_content = ?');
        values.push(encryptWithKey(content, context.dataKey));
      }

      if (updates.length === 0)
        return { success: false, error: 'No changes provided' };

      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(ability.id);

      db.prepare(`UPDATE processes SET ${updates.join(', ')} WHERE id = ?`).run(...values);

      return { success: true, message: `Updated ability "${name}"` };
    }

    case 'delete': {
      if (!name)
        return { success: false, error: 'Name is required' };

      let result = db.prepare('DELETE FROM processes WHERE user_id = ? AND name = ?').run(context.userId, name);
      if (result.changes === 0)
        return { success: false, error: `Ability "${name}" not found` };

      return { success: true, message: `Deleted ability "${name}"` };
    }

    case 'list': {
      let abilities = db.prepare(`
        SELECT name, description FROM processes WHERE user_id = ?
      `).all(context.userId);

      return {
        success:   true,
        abilities: abilities.map((a) => ({ name: a.name, description: a.description })),
      };
    }

    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

/**
 * Execute the /session command.
 */
async function executeSessionCommand(params, context) {
  let { action, name, agentId, sessionId, systemPrompt, status } = params;
  let db = getDatabase();

  switch (action) {
    case 'create':
    case 'spawn': {
      if (!name || !agentId)
        return { success: false, error: 'Name and agentId are required' };

      // Verify agent exists
      let agent = db.prepare('SELECT id, name FROM agents WHERE id = ? AND user_id = ?').get(agentId, context.userId);
      if (!agent)
        return { success: false, error: 'Agent not found' };

      // Check for duplicate name
      let existing = db.prepare('SELECT id FROM sessions WHERE user_id = ? AND name = ?').get(context.userId, name);
      if (existing)
        return { success: false, error: `Session "${name}" already exists` };

      // For spawn action, set status to 'agent' and link parent
      let finalStatus     = (action === 'spawn') ? 'agent' : (status || null);
      let parentSessionId = (action === 'spawn') ? context.sessionId : null;

      let result = db.prepare(`
        INSERT INTO sessions (user_id, agent_id, name, system_prompt, status, parent_session_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(context.userId, agentId, name, systemPrompt || null, finalStatus, parentSessionId);

      return {
        success:   true,
        message:   `Created session "${name}"`,
        sessionId: result.lastInsertRowid,
        status:    finalStatus,
      };
    }

    case 'archive': {
      if (!sessionId)
        return { success: false, error: 'sessionId is required' };

      let result = db.prepare(`
        UPDATE sessions SET status = 'archived', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `).run(sessionId, context.userId);

      if (result.changes === 0)
        return { success: false, error: 'Session not found' };

      return { success: true, message: 'Session archived' };
    }

    case 'unarchive': {
      if (!sessionId)
        return { success: false, error: 'sessionId is required' };

      let result = db.prepare(`
        UPDATE sessions SET status = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `).run(sessionId, context.userId);

      if (result.changes === 0)
        return { success: false, error: 'Session not found' };

      return { success: true, message: 'Session restored' };
    }

    case 'list': {
      let sessions = db.prepare(`
        SELECT s.id, s.name, s.status, a.name as agent_name
        FROM sessions s
        JOIN agents a ON s.agent_id = a.id
        WHERE s.user_id = ? AND (s.status IS NULL OR s.status != 'archived')
        ORDER BY s.updated_at DESC
        LIMIT 20
      `).all(context.userId);

      return {
        success:  true,
        sessions: sessions.map((s) => ({
          id:        s.id,
          name:      s.name,
          status:    s.status,
          agentName: s.agent_name,
        })),
      };
    }

    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

/**
 * Execute the /agent command.
 */
async function executeAgentCommand(params, context) {
  let { action, name, type, agentId, config } = params;
  let db = getDatabase();

  switch (action) {
    case 'list': {
      let agents = db.prepare(`
        SELECT id, name, type FROM agents WHERE user_id = ?
      `).all(context.userId);

      return {
        success: true,
        agents:  agents.map((a) => ({ id: a.id, name: a.name, type: a.type })),
      };
    }

    case 'configure': {
      if (!agentId)
        return { success: false, error: 'agentId is required' };

      let agent = db.prepare('SELECT id, encrypted_config FROM agents WHERE id = ? AND user_id = ?').get(agentId, context.userId);
      if (!agent)
        return { success: false, error: 'Agent not found' };

      // Merge with existing config
      let existingConfig = {};
      if (agent.encrypted_config) {
        try {
          existingConfig = JSON.parse(decryptWithKey(agent.encrypted_config, context.dataKey));
        } catch (e) {
          // Ignore parse errors
        }
      }

      let newConfig      = { ...existingConfig, ...config };
      let encryptedConfig = encryptWithKey(JSON.stringify(newConfig), context.dataKey);

      db.prepare(`
        UPDATE agents SET encrypted_config = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `).run(encryptedConfig, agentId, context.userId);

      return { success: true, message: 'Agent configuration updated' };
    }

    case 'delete': {
      if (!agentId)
        return { success: false, error: 'agentId is required' };

      // Check if agent has sessions
      let sessionCount = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE agent_id = ?').get(agentId);
      if (sessionCount.count > 0)
        return { success: false, error: `Agent has ${sessionCount.count} sessions. Archive or delete sessions first.` };

      let result = db.prepare('DELETE FROM agents WHERE id = ? AND user_id = ?').run(agentId, context.userId);
      if (result.changes === 0)
        return { success: false, error: 'Agent not found' };

      return { success: true, message: 'Agent deleted' };
    }

    case 'create': {
      // Creating agents requires API keys - this should generally be done through the UI
      // But we support it for automation purposes
      return {
        success: false,
        error:   'Agent creation requires API key input. Please use the UI to create agents securely.',
      };
    }

    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

export default {
  loadCommandAbilities,
};
