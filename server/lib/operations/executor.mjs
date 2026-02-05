'use strict';

import { getHandler } from './registry.mjs';
import { executePipeline } from '../pipeline/index.mjs';

// In-memory command state (commandId -> commandState)
const runningCommands = new Map();

// Subscribers for command updates (userId -> Set of callback functions)
const subscribers = new Map();

/**
 * Command states:
 * - pending: Queued but not started
 * - running: Currently executing
 * - completed: Finished successfully
 * - failed: Finished with error
 * - aborted: Cancelled by user
 */

/**
 * Subscribe to command updates for a user.
 *
 * @param {number} userId - User ID
 * @param {function} callback - Callback function receiving commandState
 * @returns {function} Unsubscribe function
 */
export function subscribeToUpdates(userId, callback) {
  if (!subscribers.has(userId))
    subscribers.set(userId, new Set());

  subscribers.get(userId).add(callback);

  // Return unsubscribe function
  return () => {
    subscribers.get(userId)?.delete(callback);
  };
}

/**
 * Broadcast command update to subscribers.
 *
 * @param {number} userId - User ID
 * @param {object} commandState - Current command state
 */
function broadcastUpdate(userId, commandState) {
  let subs = subscribers.get(userId);
  if (!subs)
    return;

  for (let callback of subs) {
    try {
      callback(commandState);
    } catch (e) {
      console.error('Error in command update subscriber:', e);
    }
  }
}

/**
 * Execute operations using the new pipeline system.
 *
 * Handles both new format (from detectOperations) and legacy array format.
 *
 * @param {object|Array} operationBlock - Operation block or legacy array
 * @param {object} context - Rich execution context
 * @returns {Promise<object>} Execution results
 */
export async function executeOperations(operationBlock, context) {
  // Legacy array format - convert to new format
  if (Array.isArray(operationBlock)) {
    operationBlock = {
      mode:       'sequential',
      assertions: operationBlock.map((op) => ({
        id:        op.id,
        assertion: 'command',
        name:      op.command,
        message:   op.message,
      })),
    };
  }

  // Callbacks for state tracking and broadcasting
  let callbacks = {
    onAssertionStart: (assertion) => {
      let commandState = {
        id:          assertion.id,
        assertion:   assertion.assertion,
        name:        assertion.name,
        message:     assertion.message,
        userId:      context.userId,
        sessionId:   context.sessionId,
        status:      'running',
        startedAt:   new Date().toISOString(),
        completedAt: null,
        result:      null,
        error:       null,
      };

      runningCommands.set(assertion.id, commandState);
      broadcastUpdate(context.userId, { ...commandState });
    },

    onAssertionComplete: (assertion, result) => {
      let commandState = runningCommands.get(assertion.id);

      if (commandState) {
        commandState.status      = 'completed';
        commandState.completedAt = new Date().toISOString();
        commandState.result      = result;
        broadcastUpdate(context.userId, { ...commandState });

        // Clean up after delay
        setTimeout(() => runningCommands.delete(assertion.id), 60000);
      }
    },

    onAssertionError: (assertion, error) => {
      let commandState = runningCommands.get(assertion.id);

      if (commandState) {
        commandState.status      = 'failed';
        commandState.completedAt = new Date().toISOString();
        commandState.error       = error.message;
        broadcastUpdate(context.userId, { ...commandState });

        // Clean up after delay
        setTimeout(() => runningCommands.delete(assertion.id), 60000);
      }
    },
  };

  // Execute using the pipeline system
  return executePipeline(operationBlock, context, callbacks);
}

/**
 * Abort a running command.
 *
 * @param {string} commandId - Command ID to abort
 * @returns {boolean} True if command was found and aborted
 */
export function abortCommand(commandId) {
  let command = runningCommands.get(commandId);

  if (!command)
    return false;

  if (command.status === 'pending' || command.status === 'running') {
    command.status      = 'aborted';
    command.completedAt = new Date().toISOString();
    broadcastUpdate(command.userId, { ...command });
    return true;
  }

  return false;
}

/**
 * Get all running/pending commands for a user.
 *
 * @param {number} userId - User ID
 * @returns {Array} Array of command states
 */
export function getRunningCommands(userId) {
  return Array.from(runningCommands.values())
    .filter((c) => c.userId === userId && ['pending', 'running'].includes(c.status));
}

/**
 * Get a specific command's state.
 *
 * @param {string} commandId - Command ID
 * @returns {object|undefined} Command state or undefined
 */
export function getCommandState(commandId) {
  return runningCommands.get(commandId);
}

export default {
  executeOperations,
  abortCommand,
  getRunningCommands,
  getCommandState,
  subscribeToUpdates,
};
