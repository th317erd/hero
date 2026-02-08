'use strict';

// ============================================================================
// Prompt Update Function
// ============================================================================
// Updates a user_prompt element in a message with the user's answer.
// Used when a user responds to an inline prompt in the chat.

import { InteractionFunction, PERMISSION } from '../function.mjs';
import { getDatabase } from '../../../database.mjs';

/**
 * PromptUpdate Function class.
 * Updates a user_prompt element with the user's answer.
 */
export class PromptUpdateFunction extends InteractionFunction {
  /**
   * Register the update_prompt function with the interaction system.
   */
  static register() {
    return {
      name:        'update_prompt',
      description: 'Update a user_prompt element with an answer',
      target:      '@system',
      permission:  PERMISSION.ALWAYS,
      schema: {
        type:       'object',
        properties: {
          message_id: {
            type:        'number',
            description: 'ID of the message containing the prompt',
          },
          prompt_id: {
            type:        'string',
            description: 'ID of the user_prompt element',
          },
          answer: {
            type:        'string',
            description: 'The user\'s answer to the prompt',
          },
        },
        required: ['message_id', 'prompt_id', 'answer'],
      },
      examples: [
        {
          description: 'Update a prompt with user answer',
          payload: {
            message_id: 123,
            prompt_id:  'prompt-abc123',
            answer:     'Blue, because it reminds me of the ocean.',
          },
        },
      ],
    };
  }

  constructor(context = {}) {
    super('update_prompt', context);
  }

  /**
   * Check if the prompt update is allowed.
   */
  async allowed(payload, context = {}) {
    if (!payload) {
      return { allowed: false, reason: 'Payload is required' };
    }

    if (!payload.message_id) {
      return { allowed: false, reason: 'message_id is required' };
    }

    if (!payload.prompt_id) {
      return { allowed: false, reason: 'prompt_id is required' };
    }

    if (!payload.answer) {
      return { allowed: false, reason: 'answer is required' };
    }

    return { allowed: true };
  }

  /**
   * Execute the prompt update.
   *
   * @param {Object} payload - The interaction payload
   * @param {number} payload.message_id - ID of the message containing the prompt
   * @param {string} payload.prompt_id - ID of the user_prompt element
   * @param {string} payload.answer - The user's answer
   * @returns {Promise<Object>} Result of the update
   */
  async execute(payload) {
    let { message_id, prompt_id, answer } = payload;

    let db = getDatabase();

    // Get the frame (message_id is now a frame ID)
    let frame = db.prepare('SELECT id, payload FROM frames WHERE id = ?').get(message_id);

    if (!frame) {
      return {
        success: false,
        error:   'Frame not found',
      };
    }

    // Parse payload JSON (stored as JSON string in database)
    let framePayload;
    try {
      framePayload = JSON.parse(frame.payload);
    } catch {
      return {
        success: false,
        error:   'Invalid frame payload',
      };
    }

    let contentStr = framePayload.content;

    // Escape XML special characters in the answer
    let escapedAnswer = escapeXml(answer);

    // Update content: find prompt by ID and add answer
    // Pattern matches: <hml-prompt id="prompt-id" ...>question</hml-prompt>
    // Also handles legacy <user-prompt> and <user_prompt> for backwards compatibility
    let pattern = new RegExp(
      `(<(?:hml-|user[-_])prompt\\s+id=["']${escapeRegex(prompt_id)}["'][^>]*)>([\\s\\S]*?)<\\/(?:hml-|user[-_])prompt>`,
      'gi'
    );

    let updated = contentStr.replace(
      pattern,
      (match, openTag, content) => {
        // Determine tag name from the match
        let tagName = 'hml-prompt';
        if (match.includes('user-prompt')) tagName = 'user-prompt';
        else if (match.includes('user_prompt')) tagName = 'user_prompt';
        // Remove any existing answered attribute before adding the new one
        let cleanedTag = openTag.replace(/\s+answered=["'][^"']*["']/gi, '');
        // Remove any existing <response> element from content
        let cleanedContent = content.replace(/<response>[\s\S]*?<\/response>/gi, '').trim();
        return `${cleanedTag} answered="true">${cleanedContent}<response>${escapedAnswer}</response></${tagName}>`;
      }
    );

    // Check if the pattern matched
    if (updated === contentStr) {
      // Try alternate pattern with different attribute order
      let altPattern = new RegExp(
        `(<(?:hml-|user[-_])prompt[^>]*\\bid=["']${escapeRegex(prompt_id)}["'][^>]*)>([\\s\\S]*?)<\\/(?:hml-|user[-_])prompt>`,
        'gi'
      );

      updated = contentStr.replace(
        altPattern,
        (match, openTag, content) => {
          let tagName = 'hml-prompt';
          if (match.includes('user-prompt')) tagName = 'user-prompt';
          else if (match.includes('user_prompt')) tagName = 'user_prompt';
          // Remove any existing answered attribute before adding the new one
          let cleanedTag = openTag.replace(/\s+answered=["'][^"']*["']/gi, '');
          // Remove any existing <response> element from content
          let cleanedContent = content.replace(/<response>[\s\S]*?<\/response>/gi, '').trim();
          return `${cleanedTag} answered="true">${cleanedContent}<response>${escapedAnswer}</response></${tagName}>`;
        }
      );
    }

    if (updated === contentStr) {
      return {
        success:  false,
        error:    'Prompt not found in message',
        promptId: prompt_id,
      };
    }

    // Update the frame payload in the database
    framePayload.content = updated;
    db.prepare('UPDATE frames SET payload = ? WHERE id = ?').run(JSON.stringify(framePayload), message_id);

    return {
      success:   true,
      promptId:  prompt_id,
      messageId: message_id,
      updated:   true,
    };
  }
}

/**
 * Escape XML special characters.
 */
function escapeXml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default PromptUpdateFunction;
