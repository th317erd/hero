'use strict';

import { readdir, readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// Cache for system processes (name -> content)
const systemProcesses = new Map();

/**
 * Load all system processes from the processes directory.
 * Markdown files are loaded as system_<basename> (e.g., act.md -> system_act)
 */
export async function loadSystemProcesses() {
  let entries = await readdir(__dirname);

  for (let entry of entries) {
    if (!entry.endsWith('.md'))
      continue;

    let name    = 'system_' + basename(entry, '.md');
    let content = await readFile(join(__dirname, entry), 'utf8');

    systemProcesses.set(name, content);
    console.log(`Loaded system process: ${name}`);
  }

  return systemProcesses;
}

/**
 * Get a system process by name.
 *
 * @param {string} name - Process name (e.g., 'system_act')
 * @returns {string | undefined} Process content or undefined
 */
export function getSystemProcess(name) {
  return systemProcesses.get(name);
}

/**
 * Get all system process names.
 *
 * @returns {string[]} Array of system process names
 */
export function getSystemProcessNames() {
  return Array.from(systemProcesses.keys());
}

/**
 * Check if a process name is a system process.
 *
 * @param {string} name - Process name
 * @returns {boolean}
 */
export function isSystemProcess(name) {
  return name.startsWith('system_');
}

/**
 * Inject processes into message content.
 * Replaces !!PROCESS_NAME!! placeholders with process content.
 *
 * @param {string} content - Message content with placeholders
 * @param {Map<string, string>} processMap - Map of process names to content
 * @returns {string} Content with placeholders replaced
 */
export function injectProcesses(content, processMap) {
  return content.replace(/!!([A-Z0-9_]+)!!/g, (match, name) => {
    let processName = name.toLowerCase();
    return processMap.get(processName) || match;
  });
}

/**
 * Build a process map from system and user processes.
 *
 * @param {string[]} processNames - List of process names to include
 * @param {Array<{name: string, content: string}>} userProcesses - User processes with decrypted content
 * @returns {Map<string, string>} Combined process map
 */
export function buildProcessMap(processNames, userProcesses = []) {
  let processMap = new Map();

  // Add requested system processes
  for (let name of processNames) {
    if (isSystemProcess(name)) {
      let content = getSystemProcess(name);
      if (content)
        processMap.set(name, content);
    }
  }

  // Add user processes
  for (let userProcess of userProcesses) {
    if (processNames.includes(userProcess.name))
      processMap.set(userProcess.name, userProcess.content);
  }

  return processMap;
}

export default {
  loadSystemProcesses,
  getSystemProcess,
  getSystemProcessNames,
  isSystemProcess,
  injectProcesses,
  buildProcessMap,
};
