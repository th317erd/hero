'use strict';

import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { ensurePluginsDir, getPluginsDir } from '../config-path.mjs';

/**
 * @typedef {object} PluginMetadata
 * @property {string} name - Plugin name
 * @property {string} version - Plugin version
 * @property {string} main - Entry point file
 * @property {Array<string>} agents - Compatible agents ('*' for all)
 * @property {string} path - Full path to plugin directory
 */

/**
 * @typedef {object} LoadedPlugin
 * @property {PluginMetadata} metadata - Plugin metadata
 * @property {object} module - Loaded module exports
 * @property {boolean} initialized - Whether init() has been called
 */

// Store for loaded plugins
const loadedPlugins = new Map();

/**
 * Discover all plugins in the plugins directory.
 *
 * @returns {Promise<Array<PluginMetadata>>} Array of plugin metadata
 */
export async function discoverPlugins() {
  let pluginsDir = getPluginsDir();
  let plugins    = [];

  try {
    await ensurePluginsDir();
    let entries = await readdir(pluginsDir, { withFileTypes: true });

    for (let entry of entries) {
      if (!entry.isDirectory())
        continue;

      let pluginPath = join(pluginsDir, entry.name);

      try {
        let metadata = await readPluginMetadata(pluginPath);

        if (metadata)
          plugins.push(metadata);
      } catch (error) {
        console.warn(`Failed to read plugin "${entry.name}":`, error.message);
      }
    }
  } catch (error) {
    console.warn('Failed to discover plugins:', error.message);
  }

  return plugins;
}

/**
 * Read plugin metadata from package.json.
 *
 * @param {string} pluginPath - Path to plugin directory
 * @returns {Promise<PluginMetadata | null>} Plugin metadata or null if invalid
 */
async function readPluginMetadata(pluginPath) {
  let packagePath = join(pluginPath, 'package.json');

  try {
    let packageJson = JSON.parse(await readFile(packagePath, 'utf8'));

    // Validate required fields
    if (!packageJson.name || !packageJson.version)
      return null;

    let main   = packageJson.main || 'index.mjs';
    let hero   = packageJson.hero || {};
    let agents = hero.agents || ['*'];

    // Verify entry point exists
    let entryPath = join(pluginPath, main);
    let stats     = await stat(entryPath);

    if (!stats.isFile()) {
      console.warn(`Plugin "${packageJson.name}" entry point not found: ${main}`);
      return null;
    }

    return {
      name:    packageJson.name,
      version: packageJson.version,
      main:    main,
      agents:  agents,
      path:    pluginPath,
    };
  } catch (error) {
    if (error.code === 'ENOENT')
      return null;

    throw error;
  }
}

/**
 * Load a plugin by metadata.
 *
 * @param {PluginMetadata} metadata - Plugin metadata
 * @param {object} context - Context passed to plugin init()
 * @returns {Promise<LoadedPlugin>} Loaded plugin
 */
export async function loadPlugin(metadata, context = {}) {
  // Check if already loaded
  if (loadedPlugins.has(metadata.name))
    return loadedPlugins.get(metadata.name);

  let entryPath = join(metadata.path, metadata.main);
  let entryUrl  = pathToFileURL(entryPath).href;

  try {
    let module = await import(entryUrl);

    let plugin = {
      metadata:    metadata,
      module:      module,
      initialized: false,
    };

    loadedPlugins.set(metadata.name, plugin);

    return plugin;
  } catch (error) {
    throw new Error(`Failed to load plugin "${metadata.name}": ${error.message}`);
  }
}

/**
 * Initialize a loaded plugin.
 *
 * @param {LoadedPlugin} plugin - Loaded plugin
 * @param {object} context - Context passed to init()
 * @returns {Promise<void>}
 */
export async function initializePlugin(plugin, context = {}) {
  if (plugin.initialized)
    return;

  if (typeof plugin.module.init === 'function') {
    try {
      await plugin.module.init(context);
    } catch (error) {
      throw new Error(`Plugin "${plugin.metadata.name}" init failed: ${error.message}`);
    }
  }

  plugin.initialized = true;
}

/**
 * Unload a plugin.
 *
 * @param {string} name - Plugin name
 * @returns {Promise<boolean>} True if plugin was unloaded
 */
export async function unloadPlugin(name) {
  let plugin = loadedPlugins.get(name);

  if (!plugin)
    return false;

  // Call destroy if available
  if (plugin.initialized && typeof plugin.module.destroy === 'function') {
    try {
      await plugin.module.destroy();
    } catch (error) {
      console.warn(`Plugin "${name}" destroy failed:`, error.message);
    }
  }

  loadedPlugins.delete(name);
  return true;
}

/**
 * Load all plugins compatible with a given agent type.
 *
 * @param {string} agentType - Agent type (e.g., 'claude')
 * @param {object} context - Context passed to plugin init()
 * @returns {Promise<Array<LoadedPlugin>>} Loaded and initialized plugins
 */
export async function loadPluginsForAgent(agentType, context = {}) {
  let allPlugins = await discoverPlugins();
  let compatible = allPlugins.filter((p) => p.agents.includes('*') || p.agents.includes(agentType));

  let loaded = [];

  for (let metadata of compatible) {
    try {
      let plugin = await loadPlugin(metadata, context);
      await initializePlugin(plugin, context);
      loaded.push(plugin);
    } catch (error) {
      console.error(`Failed to load plugin "${metadata.name}":`, error.message);
    }
  }

  return loaded;
}

/**
 * Get all loaded plugins.
 *
 * @returns {Array<LoadedPlugin>} Loaded plugins
 */
export function getLoadedPlugins() {
  return Array.from(loadedPlugins.values());
}

/**
 * Get a loaded plugin by name.
 *
 * @param {string} name - Plugin name
 * @returns {LoadedPlugin | undefined} Loaded plugin or undefined
 */
export function getPlugin(name) {
  return loadedPlugins.get(name);
}

/**
 * Check if a plugin is loaded.
 *
 * @param {string} name - Plugin name
 * @returns {boolean} True if loaded
 */
export function isPluginLoaded(name) {
  return loadedPlugins.has(name);
}

export default {
  discoverPlugins,
  loadPlugin,
  initializePlugin,
  unloadPlugin,
  loadPluginsForAgent,
  getLoadedPlugins,
  getPlugin,
  isPluginLoaded,
};
