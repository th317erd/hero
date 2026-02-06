'use strict';

// ============================================================================
// Interaction Detector
// ============================================================================
// Detects and executes interaction requests from AI agent responses.
// The AI requests interactions by outputting <interaction> tags containing JSON.
//
// Flow:
// 1. Agent outputs <interaction>JSON</interaction> tag(s) anywhere in response
// 2. System detects and parses all interaction tags
// 3. For each interaction:
//    a. Check permissions via allowed()
//    b. Send 'pending' status to agent
//    c. Execute the interaction
//    d. Send 'completed' or 'failed' status to agent
// 4. Format all results as feedback for the agent

import { getInteractionBus, queueAgentMessage, TARGETS } from './bus.mjs';
import { checkSystemMethodAllowed } from './functions/system.mjs';

// Regex to find <interaction> tag starts
const INTERACTION_START_REGEX = /<interaction>\s*/g;

// Maximum parse attempts per tag to prevent infinite loops
const MAX_PARSE_ATTEMPTS = 5;

/**
 * Find the closing </interaction> for a tag that produces valid JSON.
 * Handles cases where the JSON payload itself contains </interaction> sequences.
 *
 * Strategy: Try parsing at each </interaction> we find. If JSON.parse throws,
 * move cursor forward and keep looking until we find valid JSON,
 * hit EOF, or exceed max attempts.
 *
 * @param {string} text - Full text
 * @param {number} startIndex - Index after the opening <interaction>
 * @returns {Object|null} { endIndex, json } or null if no valid close found
 */
function findValidClosing(text, startIndex) {
  let searchFrom = startIndex;
  let attempts = 0;
  const CLOSE_TAG = '</interaction>';

  while (attempts < MAX_PARSE_ATTEMPTS) {
    let closeIndex = text.indexOf(CLOSE_TAG, searchFrom);

    if (closeIndex === -1) {
      return null; // No more closing tags - EOF
    }

    // Try to parse the content up to this </interaction>
    let jsonStr = text.slice(startIndex, closeIndex).trim();

    try {
      let parsed = JSON.parse(jsonStr);
      return { endIndex: closeIndex + CLOSE_TAG.length, json: parsed };
    } catch (e) {
      // Invalid JSON - this </interaction> might be inside a string, keep looking
      searchFrom = closeIndex + CLOSE_TAG.length;
      attempts++;
    }
  }

  // Exceeded max attempts - give up on this tag
  return null;
}

/**
 * Extract text content from response content (handles both string and array formats).
 *
 * @param {string|Array} content - Response content
 * @returns {string} Extracted text
 */
function extractTextContent(content) {
  if (typeof content === 'string')
    return content;

  if (Array.isArray(content)) {
    return content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }

  return '';
}

/**
 * Validate an interaction object.
 *
 * @param {Object} interaction - Interaction object
 * @returns {boolean} True if valid
 */
function validateInteraction(interaction) {
  if (typeof interaction !== 'object' || interaction === null)
    return false;

  // Must have target_id and target_property
  if (!interaction.target_id || typeof interaction.target_id !== 'string')
    return false;

  if (!interaction.target_property || typeof interaction.target_property !== 'string')
    return false;

  // interaction_id is required (agent generates it)
  if (!interaction.interaction_id || typeof interaction.interaction_id !== 'string')
    return false;

  return true;
}

/**
 * Detect interaction tags anywhere in the response.
 * Pattern: <interaction>JSON</interaction> (can appear multiple times, interlaced with text)
 *
 * Handles edge cases where JSON payload contains </interaction> sequences by finding
 * the closing tag that produces valid JSON.
 *
 * Interaction format:
 *   Single: { interaction_id, target_id, target_property, payload }
 *   Array:  [{ interaction_id, target_id, target_property, payload }, ...]
 *
 * @param {string|Array} content - Response content
 * @returns {Object|null} Parsed interactions, or null if no valid interaction tags found
 */
export function detectInteractions(content) {
  let text = extractTextContent(content);

  // Find all <interaction> tags
  let allInteractions = [];
  let match;

  // Reset regex state
  INTERACTION_START_REGEX.lastIndex = 0;

  while ((match = INTERACTION_START_REGEX.exec(text)) !== null) {
    let startIndex = match.index + match[0].length;

    // Find valid closing that produces valid JSON
    let result = findValidClosing(text, startIndex);

    if (!result) {
      continue; // No valid closing found for this tag
    }

    let parsed = result.json;

    // Single interaction object
    if (!Array.isArray(parsed)) {
      if (validateInteraction(parsed)) {
        allInteractions.push(parsed);
      }
    } else {
      // Array of interactions
      for (let interaction of parsed) {
        if (validateInteraction(interaction)) {
          allInteractions.push(interaction);
        }
      }
    }

    // Move past this tag to avoid re-matching
    INTERACTION_START_REGEX.lastIndex = result.endIndex;
  }

  if (allInteractions.length === 0) {
    return null;
  }

  return {
    mode:         (allInteractions.length === 1) ? 'single' : 'sequential',
    interactions: allInteractions,
  };
}

/**
 * Execute interactions through the InteractionBus.
 * Sends status updates to the agent via @agent target.
 *
 * @param {Object} interactionBlock - Parsed interaction block from detectInteractions
 * @param {Object} context - Execution context
 * @returns {Promise<Object>} Execution results
 */
export async function executeInteractions(interactionBlock, context) {
  let bus     = getInteractionBus();
  let results = [];

  for (let interactionData of interactionBlock.interactions) {
    let agentInteractionId = interactionData.interaction_id;

    // Step 1: Check permissions for @system targets
    if (interactionData.target_id === TARGETS.SYSTEM) {
      let permCheck = await checkSystemMethodAllowed(
        interactionData.target_property,
        interactionData.payload,
        context
      );

      if (!permCheck.allowed) {
        // Queue denied status for agent
        queueAgentMessage(context.sessionId, agentInteractionId, 'interaction_update', {
          status: 'denied',
          reason: permCheck.reason,
        });

        results.push({
          interaction_id:  agentInteractionId,
          target_id:       interactionData.target_id,
          target_property: interactionData.target_property,
          status:          'denied',
          reason:          permCheck.reason,
        });

        continue;
      }
    }

    // Step 2: Queue pending status for agent
    queueAgentMessage(context.sessionId, agentInteractionId, 'interaction_update', {
      status: 'pending',
      permit: 'allowed',
    });

    // Step 3: Create and send the interaction
    let interaction = bus.create(
      interactionData.target_id,
      interactionData.target_property,
      interactionData.payload,
      {
        sourceId:  agentInteractionId,
        sessionId: context.sessionId,
        userId:    context.userId,
      }
    );

    try {
      let result = await bus.send(interaction);

      // Step 4: Queue completed status for agent
      queueAgentMessage(context.sessionId, agentInteractionId, 'interaction_update', {
        status: 'completed',
        result: result,
      });

      results.push({
        interaction_id:  agentInteractionId,
        target_id:       interactionData.target_id,
        target_property: interactionData.target_property,
        status:          'completed',
        result:          result,
      });

    } catch (error) {
      // Queue failed status for agent
      queueAgentMessage(context.sessionId, agentInteractionId, 'interaction_update', {
        status: 'failed',
        error:  error.message,
      });

      results.push({
        interaction_id:  agentInteractionId,
        target_id:       interactionData.target_id,
        target_property: interactionData.target_property,
        status:          'failed',
        error:           error.message,
      });
    }
  }

  return {
    mode:    interactionBlock.mode,
    results: results,
  };
}

/**
 * Truncate a string to a maximum length, adding ellipsis if needed.
 *
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated string
 */
function truncateResult(str, maxLength = 2000) {
  if (!str || str.length <= maxLength)
    return str;

  return str.slice(0, maxLength) + '\n... [truncated]';
}

/**
 * Format interaction results as feedback for the AI.
 * Truncates large results to prevent token bloat.
 *
 * @param {Object} executionResult - Result from executeInteractions
 * @returns {string} Formatted feedback string
 */
export function formatInteractionFeedback(executionResult) {
  if (!executionResult.results || executionResult.results.length === 0)
    return 'No results.';

  return executionResult.results.map((r) => {
    let prefix = `[${r.target_id}:${r.target_property}] interaction_id='${r.interaction_id}'`;

    if (r.status === 'completed') {
      let resultStr;

      // Handle result object with status/result structure
      if (r.result && typeof r.result === 'object') {
        if (r.result.status === 'completed' && r.result.result) {
          resultStr = (typeof r.result.result === 'string')
            ? r.result.result
            : JSON.stringify(r.result.result, null, 2);
        } else if (r.result.status === 'denied') {
          return `${prefix} denied: ${r.result.reason || 'Permission denied'}`;
        } else if (r.result.status === 'failed') {
          return `${prefix} failed: ${r.result.error || 'Unknown error'}`;
        } else {
          resultStr = JSON.stringify(r.result, null, 2);
        }
      } else {
        resultStr = (typeof r.result === 'string')
          ? r.result
          : JSON.stringify(r.result, null, 2);
      }

      // Truncate large results to prevent token bloat
      resultStr = truncateResult(resultStr, 2000);

      return `${prefix} completed:\n${resultStr}`;
    }

    if (r.status === 'failed') {
      return `${prefix} failed: ${r.error}`;
    }

    if (r.status === 'denied') {
      return `${prefix} denied: ${r.reason}`;
    }

    return `${prefix} status: ${r.status}`;
  }).join('\n\n');
}

export default {
  detectInteractions,
  executeInteractions,
  formatInteractionFeedback,
};
