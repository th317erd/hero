'use strict';

// ============================================================================
// Session Participants
// ============================================================================
// Manages multi-party session membership. Sessions can have multiple
// participants (users and agents) with defined roles.
//
// Roles:
//   - owner:       The user who created the session
//   - coordinator:  The agent that responds to unaddressed messages
//   - member:       A participant who is addressed via @mention

import { getDatabase } from '../../database.mjs';
import { decryptWithKey } from '../../encryption.mjs';

// ============================================================================
// Constants
// ============================================================================

export const ParticipantType = {
  USER:  'user',
  AGENT: 'agent',
};

export const ParticipantRole = {
  OWNER:       'owner',
  COORDINATOR: 'coordinator',
  MEMBER:      'member',
};

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Add a participant to a session.
 *
 * @param {number} sessionId - Session ID
 * @param {string} participantType - 'user' or 'agent'
 * @param {number} participantId - User ID or Agent ID
 * @param {string} [role='member'] - Participant role
 * @param {Database} [database] - Optional database instance (for testing)
 * @returns {Object} The created participant record
 */
export function addParticipant(sessionId, participantType, participantId, role = 'member', database = null) {
  let db = database || getDatabase();

  let result = db.prepare(`
    INSERT INTO session_participants (session_id, participant_type, participant_id, role)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, participantType, participantId, role);

  let row = db.prepare(`
    SELECT * FROM session_participants WHERE id = ?
  `).get(result.lastInsertRowid);

  return parseParticipantRow(row);
}

/**
 * Remove a participant from a session.
 *
 * @param {number} sessionId - Session ID
 * @param {string} participantType - 'user' or 'agent'
 * @param {number} participantId - User ID or Agent ID
 * @param {Database} [database] - Optional database instance (for testing)
 * @returns {boolean} True if a participant was removed
 */
export function removeParticipant(sessionId, participantType, participantId, database = null) {
  let db = database || getDatabase();

  let result = db.prepare(`
    DELETE FROM session_participants
    WHERE session_id = ? AND participant_type = ? AND participant_id = ?
  `).run(sessionId, participantType, participantId);

  return result.changes > 0;
}

/**
 * Get all participants for a session.
 *
 * @param {number} sessionId - Session ID
 * @param {Database} [database] - Optional database instance (for testing)
 * @returns {Object[]} Array of participant records
 */
export function getSessionParticipants(sessionId, database = null) {
  let db = database || getDatabase();

  let rows = db.prepare(`
    SELECT * FROM session_participants
    WHERE session_id = ?
    ORDER BY joined_at ASC
  `).all(sessionId);

  return rows.map(parseParticipantRow);
}

/**
 * Get participants filtered by role.
 *
 * @param {number} sessionId - Session ID
 * @param {string} role - Role to filter by
 * @param {Database} [database] - Optional database instance (for testing)
 * @returns {Object[]} Array of participant records with the specified role
 */
export function getParticipantsByRole(sessionId, role, database = null) {
  let db = database || getDatabase();

  let rows = db.prepare(`
    SELECT * FROM session_participants
    WHERE session_id = ? AND role = ?
    ORDER BY joined_at ASC
  `).all(sessionId, role);

  return rows.map(parseParticipantRow);
}

/**
 * Get participants filtered by type.
 *
 * @param {number} sessionId - Session ID
 * @param {string} participantType - 'user' or 'agent'
 * @param {Database} [database] - Optional database instance (for testing)
 * @returns {Object[]} Array of participant records of the specified type
 */
export function getParticipantsByType(sessionId, participantType, database = null) {
  let db = database || getDatabase();

  let rows = db.prepare(`
    SELECT * FROM session_participants
    WHERE session_id = ? AND participant_type = ?
    ORDER BY joined_at ASC
  `).all(sessionId, participantType);

  return rows.map(parseParticipantRow);
}

/**
 * Get the primary coordinator agent for a session.
 * Returns the first agent with role='coordinator', or null if none.
 *
 * @param {number} sessionId - Session ID
 * @param {Database} [database] - Optional database instance (for testing)
 * @returns {Object|null} The coordinator participant or null
 */
export function getCoordinator(sessionId, database = null) {
  let db = database || getDatabase();

  let row = db.prepare(`
    SELECT * FROM session_participants
    WHERE session_id = ? AND participant_type = 'agent' AND role = 'coordinator'
    ORDER BY joined_at ASC
    LIMIT 1
  `).get(sessionId);

  return (row) ? parseParticipantRow(row) : null;
}

/**
 * Get all coordinator agents for a session.
 *
 * @param {number} sessionId - Session ID
 * @param {Database} [database] - Optional database instance (for testing)
 * @returns {Object[]} Array of coordinator participant records
 */
export function getCoordinators(sessionId, database = null) {
  let db = database || getDatabase();

  let rows = db.prepare(`
    SELECT * FROM session_participants
    WHERE session_id = ? AND participant_type = 'agent' AND role = 'coordinator'
    ORDER BY joined_at ASC
  `).all(sessionId);

  return rows.map(parseParticipantRow);
}

/**
 * Update a participant's role.
 *
 * @param {number} sessionId - Session ID
 * @param {string} participantType - 'user' or 'agent'
 * @param {number} participantId - User ID or Agent ID
 * @param {string} newRole - New role
 * @param {Database} [database] - Optional database instance (for testing)
 * @returns {boolean} True if a participant was updated
 */
export function updateParticipantRole(sessionId, participantType, participantId, newRole, database = null) {
  let db = database || getDatabase();

  let result = db.prepare(`
    UPDATE session_participants
    SET role = ?
    WHERE session_id = ? AND participant_type = ? AND participant_id = ?
  `).run(newRole, sessionId, participantType, participantId);

  return result.changes > 0;
}

/**
 * Check if an entity is a participant in a session.
 *
 * @param {number} sessionId - Session ID
 * @param {string} participantType - 'user' or 'agent'
 * @param {number} participantId - User ID or Agent ID
 * @param {Database} [database] - Optional database instance (for testing)
 * @returns {boolean} True if the entity is a participant
 */
export function isParticipant(sessionId, participantType, participantId, database = null) {
  let db = database || getDatabase();

  let row = db.prepare(`
    SELECT 1 FROM session_participants
    WHERE session_id = ? AND participant_type = ? AND participant_id = ?
  `).get(sessionId, participantType, participantId);

  return !!row;
}

/**
 * Get all session IDs where an entity is a participant.
 *
 * @param {string} participantType - 'user' or 'agent'
 * @param {number} participantId - User ID or Agent ID
 * @param {Database} [database] - Optional database instance (for testing)
 * @returns {number[]} Array of session IDs
 */
export function getParticipantSessions(participantType, participantId, database = null) {
  let db = database || getDatabase();

  let rows = db.prepare(`
    SELECT session_id FROM session_participants
    WHERE participant_type = ? AND participant_id = ?
    ORDER BY joined_at ASC
  `).all(participantType, participantId);

  return rows.map((row) => row.session_id);
}

// ============================================================================
// Session Loading Helpers
// ============================================================================

/**
 * Load a session with its coordinator agent's full info.
 *
 * Resolution order:
 *   1. Look up coordinator from session_participants
 *   2. Fall back to sessions.agent_id (backwards compatibility)
 *
 * @param {number} sessionId - Session ID
 * @param {number} userId - User ID (for ownership verification)
 * @param {Database} [database] - Optional database instance (for testing)
 * @returns {Object|null} Session object with agent fields, or null if not found
 */
export function loadSessionWithAgent(sessionId, userId, database = null) {
  let db = database || getDatabase();

  // Load session (without agent JOIN)
  let session = db.prepare(`
    SELECT
      s.id,
      s.name as session_name,
      s.system_prompt,
      s.status,
      s.parent_session_id,
      s.agent_id as legacy_agent_id,
      s.input_tokens,
      s.output_tokens,
      s.created_at,
      s.updated_at
    FROM sessions s
    WHERE s.id = ? AND s.user_id = ?
  `).get(sessionId, userId);

  if (!session)
    return null;

  // Try to find coordinator agent from participants
  let coordinator = getCoordinator(sessionId, db);
  let agentId = (coordinator) ? coordinator.participantId : session.legacy_agent_id;

  if (!agentId)
    return { ...session, agent_id: null, agent_name: null, agent_type: null };

  // Load full agent info
  let agent = db.prepare(`
    SELECT
      id, name, type, api_url, encrypted_api_key, encrypted_config, default_processes, default_abilities
    FROM agents
    WHERE id = ?
  `).get(agentId);

  if (!agent)
    return { ...session, agent_id: null, agent_name: null, agent_type: null };

  return {
    id:                 session.id,
    session_name:       session.session_name,
    system_prompt:      session.system_prompt,
    status:             session.status,
    parent_session_id:  session.parent_session_id,
    input_tokens:       session.input_tokens,
    output_tokens:      session.output_tokens,
    created_at:         session.created_at,
    updated_at:         session.updated_at,
    // Agent fields (same shape as the old JOIN result)
    agent_id:           agent.id,
    agent_name:         agent.name,
    agent_type:         agent.type,
    agent_api_url:      agent.api_url,
    encrypted_api_key:  agent.encrypted_api_key,
    encrypted_config:   agent.encrypted_config,
    default_processes:  agent.default_processes,
    default_abilities:  agent.default_abilities,
  };
}

/**
 * Create a session with participants.
 *
 * Accepts either a single agentId or an array of agentIds.
 * The first agent becomes the coordinator; additional agents become members.
 * The creating user becomes the owner.
 *
 * @param {Object} options
 * @param {number} options.userId - Creating user's ID
 * @param {string} options.name - Session name
 * @param {number|number[]} options.agentIds - Agent ID(s) to add as participants
 * @param {string} [options.systemPrompt] - System prompt
 * @param {string} [options.status] - Session status
 * @param {number} [options.parentSessionId] - Parent session ID
 * @param {Database} [database] - Optional database instance (for testing)
 * @returns {Object} Created session with participants
 */
export function createSessionWithParticipants(options, database = null) {
  let db = database || getDatabase();

  let agentIds = Array.isArray(options.agentIds) ? options.agentIds : [options.agentIds];
  let primaryAgentId = agentIds[0] || null;

  // Create session (keep agent_id populated for backwards compat)
  let result = db.prepare(`
    INSERT INTO sessions (user_id, agent_id, name, system_prompt, status, parent_session_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    options.userId,
    primaryAgentId,
    options.name,
    options.systemPrompt || null,
    options.status || null,
    options.parentSessionId || null
  );

  let sessionId = result.lastInsertRowid;

  // Add user as owner
  addParticipant(sessionId, 'user', options.userId, 'owner', db);

  // Add agents: first is coordinator, rest are members
  for (let i = 0; i < agentIds.length; i++) {
    let role = (i === 0) ? 'coordinator' : 'member';
    addParticipant(sessionId, 'agent', agentIds[i], role, db);
  }

  return {
    id:               sessionId,
    userId:           options.userId,
    name:             options.name,
    systemPrompt:     options.systemPrompt || null,
    status:           options.status || null,
    parentSessionId:  options.parentSessionId || null,
    participants:     getSessionParticipants(sessionId, db),
  };
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Parse a database row into a participant object.
 *
 * @param {Object} row - Database row
 * @returns {Object} Parsed participant
 */
function parseParticipantRow(row) {
  return {
    id:              row.id,
    sessionId:       row.session_id,
    participantType: row.participant_type,
    participantId:   row.participant_id,
    role:            row.role,
    joinedAt:        row.joined_at,
  };
}

export default {
  ParticipantType,
  ParticipantRole,
  addParticipant,
  removeParticipant,
  getSessionParticipants,
  getParticipantsByRole,
  getParticipantsByType,
  getCoordinator,
  getCoordinators,
  updateParticipantRole,
  isParticipant,
  getParticipantSessions,
  loadSessionWithAgent,
  createSessionWithParticipants,
};
