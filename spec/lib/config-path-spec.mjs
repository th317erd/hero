'use strict';

import { platform, homedir } from 'os';
import { join } from 'path';
import {
  getConfigDir,
  ensureConfigDir,
  getDatabasePath,
  getPluginsDir,
  ensurePluginsDir,
} from '../../server/lib/config-path.mjs';
import { existsSync, rmSync } from 'fs';

describe('Config path module', () => {
  describe('getConfigDir', () => {
    it('should return a string path', () => {
      let configDir = getConfigDir();

      expect(typeof configDir).toBe('string');
      expect(configDir.length).toBeGreaterThan(0);
    });

    it('should return OS-specific path', () => {
      let configDir = getConfigDir();
      let home      = homedir();

      switch (platform()) {
        case 'darwin':
          expect(configDir).toBe(join(home, 'Library', 'Application Support', 'hero'));
          break;

        case 'win32':
          expect(configDir).toContain('hero');
          break;

        default:
          // Linux and others
          expect(configDir).toContain('.config');
          expect(configDir).toContain('hero');
          break;
      }
    });

    it('should include "hero" in the path', () => {
      let configDir = getConfigDir();

      expect(configDir).toContain('hero');
    });
  });

  describe('getDatabasePath', () => {
    it('should return path ending with hero.db', () => {
      let dbPath = getDatabasePath();

      expect(dbPath).toMatch(/hero\.db$/);
    });

    it('should be inside config directory', () => {
      let configDir = getConfigDir();
      let dbPath    = getDatabasePath();

      expect(dbPath).toBe(join(configDir, 'hero.db'));
    });
  });

  describe('getPluginsDir', () => {
    it('should return path ending with plugins', () => {
      let pluginsDir = getPluginsDir();

      expect(pluginsDir).toMatch(/plugins$/);
    });

    it('should be inside config directory', () => {
      let configDir  = getConfigDir();
      let pluginsDir = getPluginsDir();

      expect(pluginsDir).toBe(join(configDir, 'plugins'));
    });
  });

  describe('ensureConfigDir', () => {
    it('should create config directory if it does not exist', () => {
      // This test is somewhat integration-y, but important
      let configDir = ensureConfigDir();

      expect(existsSync(configDir)).toBe(true);
    });

    it('should return the config directory path', () => {
      let result    = ensureConfigDir();
      let configDir = getConfigDir();

      expect(result).toBe(configDir);
    });
  });

  describe('ensurePluginsDir', () => {
    it('should create plugins directory if it does not exist', () => {
      let pluginsDir = ensurePluginsDir();

      expect(existsSync(pluginsDir)).toBe(true);
    });

    it('should return the plugins directory path', () => {
      let result     = ensurePluginsDir();
      let pluginsDir = getPluginsDir();

      expect(result).toBe(pluginsDir);
    });
  });
});
