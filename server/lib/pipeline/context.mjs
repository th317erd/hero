'use strict';

import { getDatabase } from '../../database.mjs';
import { decryptWithKey } from '../../encryption.mjs';

/**
 * Build a rich context object for pipeline execution.
 *
 * This context is passed to ALL handlers, plugins, and assertions.
 * It contains user, session, agent, and model information.
 *
 * @param {object} options - Context building options
 * @param {object} options.req - Express request object (with user attached)
 * @param {string} options.sessionId - Current session ID
 * @param {string} options.dataKey - User's data encryption key
 * @param {string} [options.messageId] - Optional message ID for WebSocket updates
 * @param {AbortSignal} [options.signal] - Optional abort signal
 * @returns {object} Rich context object
 */
export function buildContext(options) {
  let { req, sessionId, dataKey, messageId, signal } = options;

  let db = getDatabase();

  // Get session with full agent info
  let session = db.prepare(`
    SELECT
      s.id as session_id,
      s.name as session_name,
      s.system_prompt,
      a.id as agent_id,
      a.name as agent_name,
      a.type as agent_type,
      a.api_url as agent_api_url,
      a.encrypted_api_key,
      a.encrypted_config,
      a.default_processes
    FROM sessions s
    JOIN agents a ON s.agent_id = a.id
    WHERE s.id = ? AND s.user_id = ?
  `).get(sessionId, req.user.id);

  if (!session)
    throw new Error('Session not found');

  // Decrypt agent config
  let agentConfig = {};

  if (session.encrypted_config) {
    let decrypted = decryptWithKey(session.encrypted_config, dataKey);
    agentConfig   = JSON.parse(decrypted);
  }

  // Parse default processes
  let defaultProcesses = JSON.parse(session.default_processes || '[]');

  // Build model info from agent config
  let model = {
    name:      agentConfig.model || getDefaultModel(session.agent_type),
    maxTokens: agentConfig.maxTokens || 4096,
  };

  // Copy additional model params if present
  if (agentConfig.temperature !== undefined)
    model.temperature = agentConfig.temperature;

  if (agentConfig.topP !== undefined)
    model.topP = agentConfig.topP;

  if (agentConfig.topK !== undefined)
    model.topK = agentConfig.topK;

  return {
    // User & Auth
    userId:    req.user.id,
    username:  req.user.username,
    sessionId: sessionId,
    dataKey:   dataKey,

    // Agent Configuration
    agent: {
      id:               session.agent_id,
      name:             session.agent_name,
      type:             session.agent_type,
      apiUrl:           session.agent_api_url,
      config:           agentConfig,
      defaultProcesses: defaultProcesses,
    },

    // Current Model Info
    model: model,

    // Session State
    session: {
      id:           session.session_id,
      name:         session.session_name,
      systemPrompt: session.system_prompt,
    },

    // Abort Signal
    signal: signal || null,

    // Pipeline State (updated during execution)
    pipeline: {
      index:    0,
      handlers: [],
    },

    // Message tracking (for WebSocket updates)
    messageId: messageId || null,
  };
}

/**
 * Get the default model for an agent type.
 *
 * @param {string} agentType - Agent type (e.g., 'claude', 'openai')
 * @returns {string} Default model name
 */
function getDefaultModel(agentType) {
  switch (agentType) {
    case 'claude':
      return 'claude-sonnet-4-20250514';
    case 'openai':
      return 'gpt-4';
    default:
      return 'unknown';
  }
}

/**
 * Clone a context with updated fields.
 *
 * @param {object} context - Original context
 * @param {object} updates - Fields to update
 * @returns {object} New context with updates
 */
export function updateContext(context, updates) {
  return {
    ...context,
    ...updates,
    // Deep clone nested objects that might be updated
    pipeline: updates.pipeline
      ? { ...context.pipeline, ...updates.pipeline }
      : context.pipeline,
  };
}

export default {
  buildContext,
  updateContext,
};
