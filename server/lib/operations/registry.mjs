'use strict';

// Registry of operation handlers (command name -> handler)
const handlers = new Map();

/**
 * Register an operation handler.
 *
 * @param {string} command - Command name
 * @param {object} handler - Handler object with name, description, and execute function
 */
export function registerHandler(command, handler) {
  handlers.set(command, handler);
  console.log(`Registered operation handler: ${command}`);
}

/**
 * Get a handler for a command.
 *
 * @param {string} command - Command name
 * @returns {object|undefined} Handler or undefined
 */
export function getHandler(command) {
  return handlers.get(command);
}

/**
 * Get all available command names (sorted alphabetically for pipeline order).
 *
 * @returns {string[]} Sorted array of command names
 */
export function getAvailableCommands() {
  return Array.from(handlers.keys()).sort();
}

/**
 * Check if a handler exists for a command.
 *
 * @param {string} command - Command name
 * @returns {boolean}
 */
export function hasHandler(command) {
  return handlers.has(command);
}

// Import and register built-in handlers
import webSearchHandler from './handlers/web-search.mjs';
registerHandler('web_search', webSearchHandler);

// Legacy alias for backward compatibility
registerHandler('system_web_search', webSearchHandler);

export default {
  registerHandler,
  getHandler,
  getAvailableCommands,
  hasHandler,
};
