'use strict';

import { getHandler } from '../operations/registry.mjs';

/**
 * Command assertion handler.
 *
 * Executes the named command/function and returns its result.
 * This handler looks up the command by name in the registry
 * and delegates execution to that handler.
 */
export default {
  name:        'assertion_command',
  description: 'Execute a command/function',

  /**
   * Execute a command assertion.
   *
   * @param {object} assertion - The assertion object { id, assertion, name, message }
   * @param {object} context - Rich execution context
   * @param {function} next - Middleware next function
   * @returns {Promise<any>} The command result
   */
  async execute(assertion, context, next) {
    // Only handle 'command' assertions
    if (assertion.assertion !== 'command')
      return next(assertion);

    // Look up the named handler
    let handler = getHandler(assertion.name);

    if (!handler) {
      // No handler found for this command name
      // Return error result but continue pipeline
      let result = {
        error:   true,
        message: `Unknown command: ${assertion.name}`,
      };

      return next({ ...assertion, result });
    }

    try {
      // Execute the handler
      // Pass a wrapped next that attaches the result
      let result = await handler.execute(assertion, context, async (msg) => {
        // Handler called next, continue pipeline with result
        return msg;
      });

      // Attach result and continue
      return next({ ...assertion, result });

    } catch (error) {
      // Handler threw an error
      let result = {
        error:   true,
        message: error.message,
      };

      return next({ ...assertion, result });
    }
  },
};
