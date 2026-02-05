'use strict';

// ============================================================================
// Builtin Ability Loader
// ============================================================================
// Loads built-in function abilities (websearch, bash, etc.)

import { registerAbility, clearAbilitiesBySource } from '../registry.mjs';

/**
 * Built-in function abilities.
 * These are core functions that come with the system.
 */
const BUILTIN_ABILITIES = [
  {
    name:        'websearch',
    type:        'function',
    description: 'Search the web for information',
    category:    'search',
    tags:        ['web', 'search', 'internet'],
    inputSchema: {
      type:       'object',
      properties: {
        query:  { type: 'string', description: 'Search query' },
        engine: { type: 'string', enum: ['google', 'duckduckgo'], default: 'google' },
        limit:  { type: 'number', default: 5, minimum: 1, maximum: 20 },
      },
      required: ['query'],
    },
    permissions: {
      autoApprove:       false,
      autoApprovePolicy: 'ask',
      dangerLevel:       'safe',
    },
    execute: async (params, context) => {
      // Placeholder - actual implementation in operations handler
      return {
        success: true,
        message: `Web search for: ${params.query}`,
        results: [],
      };
    },
  },
  {
    name:        'bash',
    type:        'function',
    description: 'Execute a shell command (requires approval)',
    category:    'system',
    tags:        ['shell', 'command', 'terminal'],
    inputSchema: {
      type:       'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd:     { type: 'string', description: 'Working directory' },
        timeout: { type: 'number', default: 30000, description: 'Timeout in milliseconds' },
      },
      required: ['command'],
    },
    permissions: {
      autoApprove:       false,
      autoApprovePolicy: 'ask',
      dangerLevel:       'dangerous',
    },
    execute: async (params, context) => {
      // NOOP for now - returns placeholder
      // Actual execution will be implemented with approval system
      return {
        success: false,
        message: 'Command execution pending approval system implementation',
        command: params.command,
      };
    },
  },
  {
    name:        'ask_user',
    type:        'function',
    description: 'Ask the user a question and wait for response',
    category:    'interaction',
    tags:        ['user', 'input', 'question'],
    inputSchema: {
      type:       'object',
      properties: {
        question:     { type: 'string', description: 'Question to ask' },
        type:         { type: 'string', enum: ['binary', 'number', 'float', 'string'], default: 'string' },
        timeout:      { type: 'number', description: 'Timeout in milliseconds (0 = no timeout)' },
        defaultValue: { type: 'string', description: 'Default value if timeout' },
        options:      { type: 'array', items: { type: 'string' }, description: 'Options for selection' },
      },
      required: ['question'],
    },
    permissions: {
      autoApprove:       true,  // Questions auto-approve (they ARE the approval)
      autoApprovePolicy: 'always',
      dangerLevel:       'safe',
    },
    execute: async (params, context) => {
      // Will be handled by question system
      return { pending: true, questionId: null };
    },
  },
  {
    name:        'read_file',
    type:        'function',
    description: 'Read contents of a file',
    category:    'filesystem',
    tags:        ['file', 'read', 'filesystem'],
    inputSchema: {
      type:       'object',
      properties: {
        path:     { type: 'string', description: 'File path to read' },
        encoding: { type: 'string', default: 'utf8' },
      },
      required: ['path'],
    },
    permissions: {
      autoApprove:       false,
      autoApprovePolicy: 'session',
      dangerLevel:       'moderate',
    },
    execute: async (params, context) => {
      // Placeholder
      return { success: false, message: 'File operations pending implementation' };
    },
  },
  {
    name:        'write_file',
    type:        'function',
    description: 'Write contents to a file',
    category:    'filesystem',
    tags:        ['file', 'write', 'filesystem'],
    inputSchema: {
      type:       'object',
      properties: {
        path:     { type: 'string', description: 'File path to write' },
        content:  { type: 'string', description: 'Content to write' },
        encoding: { type: 'string', default: 'utf8' },
      },
      required: ['path', 'content'],
    },
    permissions: {
      autoApprove:       false,
      autoApprovePolicy: 'ask',
      dangerLevel:       'dangerous',
    },
    execute: async (params, context) => {
      // Placeholder
      return { success: false, message: 'File operations pending implementation' };
    },
  },
];

/**
 * Load all built-in abilities.
 *
 * @returns {number} Number of abilities loaded
 */
export function loadBuiltinAbilities() {
  // Clear existing builtin abilities
  clearAbilitiesBySource('builtin');

  let count = 0;

  for (let ability of BUILTIN_ABILITIES) {
    registerAbility({
      ...ability,
      id:        `builtin-${ability.name}`,
      source:    'builtin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    count++;
    console.log(`Loaded builtin ability: ${ability.name}`);
  }

  return count;
}

export default { loadBuiltinAbilities };
