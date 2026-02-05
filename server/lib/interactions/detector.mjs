'use strict';

// ============================================================================
// Interaction Detector
// ============================================================================
// Detects and executes interaction requests from AI agent responses.
// The AI can request interactions by outputting a JSON code block.
//
// Flow:
// 1. Agent outputs JSON block with interactions
// 2. System detects and parses interactions
// 3. For each interaction:
//    a. Check permissions via allowed()
//    b. Send 'pending' status to agent
//    c. Execute the interaction
//    d. Send 'completed' or 'failed' status to agent
// 4. Format all results as feedback for the agent

import { getInteractionBus, queueAgentMessage, TARGETS } from './bus.mjs';
import { checkSystemMethodAllowed } from './functions/system.mjs';

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
 * Detect if response contains an interaction block.
 * Pattern: trimmed content starts with ```json and ends with ```
 *
 * Interaction format:
 *   Single: { interaction_id, target_id, target_property, payload }
 *   Array:  [{ interaction_id, target_id, target_property, payload }, ...]
 *
 * @param {string|Array} content - Response content
 * @returns {Object|null} Parsed interactions, or null if not an interaction block
 */
export function detectInteractions(content) {
  let text    = extractTextContent(content);
  let trimmed = text.trim();

  // Must start with ```json and end with ```
  if (!trimmed.startsWith('```json') || !trimmed.endsWith('```'))
    return null;

  // Extract JSON content
  let jsonStr = trimmed.slice(7, -3).trim();

  try {
    let parsed = JSON.parse(jsonStr);

    // Single interaction object
    if (!Array.isArray(parsed)) {
      if (!validateInteraction(parsed))
        return null;

      return {
        mode:         'single',
        interactions: [parsed],
      };
    }

    // Array of interactions
    for (let interaction of parsed) {
      if (!validateInteraction(interaction))
        return null;
    }

    return {
      mode:         'sequential',
      interactions: parsed,
    };

  } catch (e) {
    return null;
  }
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
 * Format interaction results as feedback for the AI.
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
          resultStr = typeof r.result.result === 'string'
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
        resultStr = typeof r.result === 'string'
          ? r.result
          : JSON.stringify(r.result, null, 2);
      }

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
