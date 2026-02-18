'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ============================================================================
// Environment Setup (must happen before any app module imports)
// ============================================================================

let testDir = mkdtempSync(join(tmpdir(), 'hero-cmd-handler-test-'));

process.env.HERO_JWT_SECRET = 'test-secret-key-for-testing';
process.env.HERO_ENCRYPTION_KEY = 'test-encryption-key-32chars!!';
process.env.XDG_CONFIG_HOME = testDir;

// Dynamic imports after env is configured
let handleCommandInterception;
let database;
let auth;

async function loadModules() {
  database = await import('../../../server/database.mjs');
  auth = await import('../../../server/auth.mjs');
  let mod = await import('../../../server/lib/messaging/command-handler.mjs');
  handleCommandInterception = mod.handleCommandInterception;
}

describe('command-handler', async () => {
  await loadModules();

  let db;
  let userId;
  let sessionId;
  let agentId;

  beforeEach(async () => {
    db = database.getDatabase();

    // Clear test data for isolation
    db.exec('DELETE FROM frames');
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM agents');
    db.exec('DELETE FROM users');

    // Create test user
    let user = await auth.createUser('testuser', 'testpass');
    userId = user.id;

    // Create test agent
    let agentResult = db.prepare(`
      INSERT INTO agents (user_id, name, type, encrypted_api_key)
      VALUES (?, 'test-agent', 'claude', 'fake-key')
    `).run(userId);
    agentId = Number(agentResult.lastInsertRowid);

    // Create test session
    let sessionResult = db.prepare(`
      INSERT INTO sessions (user_id, agent_id, name)
      VALUES (?, ?, 'Test Session')
    `).run(userId, agentId);
    sessionId = Number(sessionResult.lastInsertRowid);
  });

  describe('handleCommandInterception()', () => {
    it('should return handled: false for non-command content', async () => {
      let result = await handleCommandInterception({
        content: 'Hello world',
        sessionId,
        userId,
      });
      assert.strictEqual(result.handled, false);
    });

    it('should return handled: true for /help', async () => {
      let result = await handleCommandInterception({
        content: '/help',
        sessionId,
        userId,
      });
      assert.strictEqual(result.handled, true);
      assert.ok(result.result);
      assert.strictEqual(result.result.command, 'help');
      assert.strictEqual(result.result.success, true);
    });

    it('should return 404 for non-existent session', async () => {
      let result = await handleCommandInterception({
        content: '/help',
        sessionId: 99999,
        userId,
      });
      assert.strictEqual(result.handled, true);
      assert.strictEqual(result.status, 404);
      assert.ok(result.error);
    });

    it('should create user message frame', async () => {
      await handleCommandInterception({
        content: '/help',
        sessionId,
        userId,
      });

      let frames = db.prepare(`
        SELECT * FROM frames WHERE session_id = ? AND author_type = 'user'
      `).all(sessionId);
      assert.ok(frames.length > 0, 'Should have created a user frame');
    });

    it('should create agent response frame', async () => {
      await handleCommandInterception({
        content: '/help',
        sessionId,
        userId,
      });

      let frames = db.prepare(`
        SELECT * FROM frames WHERE session_id = ? AND author_type = 'agent'
      `).all(sessionId);
      assert.ok(frames.length > 0, 'Should have created an agent frame');
    });

    it('should return handled: false for non-command text', async () => {
      let result = await handleCommandInterception({
        content: 'not a /command',
        sessionId,
        userId,
      });
      assert.strictEqual(result.handled, false);
    });

    it('should handle /session command', async () => {
      let result = await handleCommandInterception({
        content: '/session',
        sessionId,
        userId,
      });
      assert.strictEqual(result.handled, true);
      assert.strictEqual(result.result.command, 'session');
      assert.strictEqual(result.result.success, true);
    });

    it('should handle unknown commands', async () => {
      let result = await handleCommandInterception({
        content: '/nonexistent_xyz',
        sessionId,
        userId,
      });
      assert.strictEqual(result.handled, true);
      assert.ok(result.result);
    });

    it('should reject wrong user for session', async () => {
      let otherUser = await auth.createUser('otheruser', 'otherpass');

      let result = await handleCommandInterception({
        content: '/help',
        sessionId,
        userId: otherUser.id,
      });
      assert.strictEqual(result.handled, true);
      assert.strictEqual(result.status, 404);
    });

    it('should handle /stream command', async () => {
      let result = await handleCommandInterception({
        content: '/stream on',
        sessionId,
        userId,
      });
      assert.strictEqual(result.handled, true);
      assert.strictEqual(result.result.command, 'stream');
    });

    it('should handle command with leading whitespace', async () => {
      let result = await handleCommandInterception({
        content: '  /help',
        sessionId,
        userId,
      });
      assert.strictEqual(result.handled, true);
      assert.strictEqual(result.result.command, 'help');
    });
  });
});
