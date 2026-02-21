'use strict';

// ============================================================================
// Builtin Ability Loader
// ============================================================================
// Loads built-in function abilities (websearch, bash, etc.) and
// conditional abilities that activate based on conversation context.

import { registerAbility, clearAbilitiesBySource } from '../registry.mjs';
import { getUnansweredPrompts } from '../conditional.mjs';

/**
 * Built-in conditional abilities.
 * These are rules that trigger based on conversation context.
 * The AI evaluates the "applies" condition and follows the "message" instruction.
 */
const BUILTIN_CONDITIONAL_ABILITIES = [
  {
    name:        'prompt_response_handler',
    type:        'process',
    description: 'Detects when user answers an hml-prompt via chat and updates the prompt',
    category:    'interaction',
    tags:        ['prompt', 'hml', 'ipc', 'auto'],
    applies:     'The user responds to an hml-prompt question without using the IPC layer',
    message:     `The user may be answering an hml-prompt question in regular chat. When you respond:

1. First, output a <thinking> block where you consider:
   - Which unanswered prompt (if any) the user's message is answering
   - What the user's answer means in context

2. If the user IS answering a prompt, send an \`update_prompt\` interaction to update the original prompt:

<interaction>
{
  "interaction_id": "prompt-update-<random>",
  "target_id": "@system",
  "target_property": "update_prompt",
  "payload": {
    "message_id": <the message ID containing the prompt>,
    "prompt_id": "<the prompt's id attribute>",
    "answer": "<the user's answer>"
  }
}
</interaction>

3. Then continue your response naturally.

The <thinking> block will be shown to the user in a collapsible "thinking" display.`,
    permissions: {
      autoApprove:       true,
      autoApprovePolicy: 'always',
      dangerLevel:       'safe',
    },
    /**
     * Programmatic condition matcher.
     * Checks if there are unanswered prompts and the user is responding via chat.
     *
     * @param {Object} context - The message context
     * @returns {Object} Match result with details
     */
    matchCondition: (context) => {
      let { userMessage, sessionID, testDb } = context;

      // If the user's message already contains an interaction tag, they're using IPC
      if (userMessage.includes('<interaction')) {
        return { matches: false };
      }

      // Get unanswered prompts from recent messages
      let unansweredPrompts = getUnansweredPrompts(sessionID, testDb);

      if (unansweredPrompts.length === 0) {
        return { matches: false };
      }

      // The user is sending a message and there are unanswered prompts
      // This is likely an answer to one of them (Claude will determine which one)
      console.log('[Conditional] User may be answering a prompt, found', unansweredPrompts.length, 'unanswered');

      return {
        matches: true,
        details: {
          unansweredPrompts: unansweredPrompts,
          hint:              'The user may be responding to one of these prompts. Determine which one based on context.',
        },
      };
    },
  },
];

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
 * Load all built-in abilities (both function and conditional).
 *
 * @returns {number} Number of abilities loaded
 */
export function loadBuiltinAbilities() {
  // Clear existing builtin abilities
  clearAbilitiesBySource('builtin');

  let count = 0;

  // Load function abilities
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

  // Load conditional abilities
  for (let ability of BUILTIN_CONDITIONAL_ABILITIES) {
    registerAbility({
      ...ability,
      id:        `builtin-${ability.name}`,
      source:    'builtin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    count++;
    console.log(`Loaded builtin conditional ability: ${ability.name}`);
  }

  return count;
}

export default { loadBuiltinAbilities };
