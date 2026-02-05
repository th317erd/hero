'use strict';

import { registerHandler } from '../operations/registry.mjs';

// Import assertion handlers
import commandHandler from './command.mjs';
import questionHandler from './question.mjs';
import responseHandler from './response.mjs';
import thinkingHandler from './thinking.mjs';

// Register all assertion handlers
// These are sorted alphabetically for pipeline order
registerHandler('assertion_command', commandHandler);
registerHandler('assertion_question', questionHandler);
registerHandler('assertion_response', responseHandler);
registerHandler('assertion_thinking', thinkingHandler);

/**
 * Assertion types and their behaviors.
 */
export const ASSERTION_TYPES = {
  command:  'command',   // Execute a function/plugin
  question: 'question',  // Prompt user for input
  response: 'response',  // Display message to user
  thinking: 'thinking',  // Show processing status
  stream:   'stream',    // Real-time output stream
};

/**
 * Get handler for an assertion type.
 *
 * @param {string} assertionType - The assertion type
 * @returns {object|null} The handler or null
 */
export function getAssertionHandler(assertionType) {
  switch (assertionType) {
    case 'command':
      return commandHandler;
    case 'question':
      return questionHandler;
    case 'response':
      return responseHandler;
    case 'thinking':
      return thinkingHandler;
    default:
      return null;
  }
}

export default {
  ASSERTION_TYPES,
  getAssertionHandler,
};
