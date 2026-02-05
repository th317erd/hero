'use strict';

import { broadcastToUser } from '../websocket.mjs';
import {
  setPendingQuestion,
  hasPendingQuestion,
  removePendingQuestion,
} from './pending-questions.mjs';

// Re-export answer/cancel functions for convenience
export { answerQuestion, cancelQuestion } from './pending-questions.mjs';

/**
 * Question assertion handler.
 *
 * Prompts the user for input via WebSocket.
 * Supports both blocking (wait forever) and non-blocking (with timeout) modes.
 */
export default {
  name:        'assertion_question',
  description: 'Prompt user for input',

  /**
   * Execute a question assertion.
   *
   * @param {object} assertion - The assertion object
   * @param {object} context - Rich execution context
   * @param {function} next - Middleware next function
   * @returns {Promise<any>} The user's answer
   */
  async execute(assertion, context, next) {
    // Only handle 'question' assertions
    if (assertion.assertion !== 'question')
      return next(assertion);

    let {
      id,
      name,
      message,
      blocking = true,
      timeout  = 0,        // 0 = no timeout (block forever)
      options  = null,     // Optional predefined answers
    } = assertion;

    // Default value for non-blocking questions
    let defaultValue = assertion.default || null;

    // Broadcast question to user via WebSocket
    broadcastToUser(context.userId, {
      type:        'question_prompt',
      messageId:   context.messageId,
      assertionId: id,
      question:    message,
      options:     options,
      blocking:    blocking,
      timeout:     timeout,
    });

    // Create promise that resolves when user answers
    let answer = await new Promise((resolve, reject) => {
      // Store resolver for this question
      setPendingQuestion(id, resolve, reject);

      // Set up timeout if specified
      if (timeout > 0) {
        setTimeout(() => {
          if (hasPendingQuestion(id)) {
            removePendingQuestion(id);

            if (blocking) {
              // Blocking question timed out - use default or error
              if (defaultValue !== null) {
                resolve(defaultValue);
              } else {
                reject(new Error('Question timed out'));
              }
            } else {
              // Non-blocking - just resolve with default
              resolve(defaultValue);
            }
          }
        }, timeout);
      }
    });

    // Clean up
    removePendingQuestion(id);

    // Attach answer and continue
    return next({
      ...assertion,
      result: { answer },
    });
  },
};
