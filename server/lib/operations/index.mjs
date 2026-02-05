'use strict';

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
    // Find text blocks and concatenate
    return content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }

  return '';
}

/**
 * Normalize an operation to the new assertion format.
 * Handles backward compatibility with old { id, command, message } format.
 *
 * @param {object} op - Operation object
 * @returns {object} Normalized assertion object
 */
function normalizeAssertion(op) {
  // New format already has assertion field
  if (op.assertion)
    return op;

  // Old format: { id, command, message } -> { id, assertion: 'command', name: command, message }
  if (op.command) {
    return {
      id:        op.id,
      assertion: 'command',
      name:      op.command,
      message:   op.message || '',
    };
  }

  // Unknown format, return as-is
  return op;
}

/**
 * Validate a single assertion object.
 *
 * @param {object} op - Assertion object
 * @returns {boolean} True if valid
 */
function validateAssertion(op) {
  if (typeof op !== 'object' || op === null)
    return false;

  if (!op.id || typeof op.id !== 'string')
    return false;

  // New format: requires assertion and name
  if (op.assertion) {
    if (typeof op.assertion !== 'string')
      return false;

    if (!op.name || typeof op.name !== 'string')
      return false;
  }
  // Old format: requires command
  else if (op.command) {
    if (typeof op.command !== 'string')
      return false;
  }
  else {
    return false;
  }

  return true;
}

/**
 * Detect if response contains an operation block.
 * Pattern: trimmed content starts with ```json and ends with ```
 *
 * Supports two execution modes:
 * - Array [...]: Sequential execution with transformation between steps
 * - Object { key: [...], ... }: Parallel execution of each key's pipeline
 *
 * Supports two formats:
 * - New: { id, assertion, name, message }
 * - Old: { id, command, message } (backward compatible)
 *
 * @param {string|Array} content - Response content
 * @returns {object|null} Parsed operations with mode info, or null if not an operation block
 */
export function detectOperations(content) {
  let text    = extractTextContent(content);
  let trimmed = text.trim();

  // Must start with ```json and end with ```
  if (!trimmed.startsWith('```json') || !trimmed.endsWith('```'))
    return null;

  // Extract JSON content (remove ```json and ```)
  let jsonStr = trimmed.slice(7, -3).trim();

  try {
    let parsed = JSON.parse(jsonStr);

    // Array = sequential execution
    if (Array.isArray(parsed)) {
      // Validate each operation
      for (let op of parsed) {
        if (!validateAssertion(op))
          return null;
      }

      // Normalize to new format
      let assertions = parsed.map(normalizeAssertion);

      return {
        mode:       'sequential',
        assertions: assertions,
        pipelines:  null,
      };
    }

    // Object = parallel execution
    if (typeof parsed === 'object' && parsed !== null) {
      let pipelines = {};

      for (let [key, pipeline] of Object.entries(parsed)) {
        // Each key must be an array
        if (!Array.isArray(pipeline))
          return null;

        // Validate each operation in the pipeline
        for (let op of pipeline) {
          if (!validateAssertion(op))
            return null;
        }

        // Normalize to new format
        pipelines[key] = pipeline.map(normalizeAssertion);
      }

      return {
        mode:       'parallel',
        assertions: null,
        pipelines:  pipelines,
      };
    }

    return null;
  } catch (e) {
    // JSON parse error - not a valid operation block
    return null;
  }
}

/**
 * Format operation results as feedback for the AI.
 *
 * Handles both sequential and parallel results.
 *
 * @param {object} executionResult - Execution result from executeOperations
 * @returns {string} Formatted feedback string
 */
export function formatOperationFeedback(executionResult) {
  // Handle legacy array format (from old executeOperations)
  if (Array.isArray(executionResult))
    return formatResultsArray(executionResult);

  // Handle new format with mode
  if (executionResult.mode === 'sequential')
    return formatResultsArray(executionResult.results);

  if (executionResult.mode === 'parallel') {
    let parts = [];

    for (let [key, results] of Object.entries(executionResult.pipelineResults)) {
      parts.push(`=== Pipeline "${key}" ===`);
      parts.push(formatResultsArray(results));
    }

    return parts.join('\n\n');
  }

  // Fallback
  return 'Operation completed.';
}

/**
 * Format an array of results.
 *
 * @param {Array} results - Array of result objects
 * @returns {string} Formatted string
 */
function formatResultsArray(results) {
  if (!results || results.length === 0)
    return 'No results.';

  return results.map((r) => {
    let prefix = r.assertion
      ? `[${r.assertion}:${r.name}] id='${r.id}'`
      : `id='${r.id}'`;

    if (r.status === 'completed') {
      let resultStr = typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2);
      return `${prefix} completed:\n${resultStr}`;
    } else if (r.status === 'failed') {
      return `${prefix} failed: ${r.error}`;
    } else if (r.status === 'aborted') {
      return `${prefix} aborted by user`;
    } else if (r.status === 'timeout') {
      return `${prefix} timed out`;
    }

    return `${prefix} status: ${r.status}`;
  }).join('\n\n');
}

export { executeOperations, abortCommand, getRunningCommands } from './executor.mjs';
export { registerHandler, getHandler, getAvailableCommands } from './registry.mjs';

export default {
  detectOperations,
  formatOperationFeedback,
};
