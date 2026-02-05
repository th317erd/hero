'use strict';

import Database from 'better-sqlite3';
import { ensureConfigDir, getDatabasePath } from './lib/config-path.mjs';

let db = null;

/**
 * Get the database instance, creating it if necessary.
 *
 * @returns {Database} SQLite database instance
 */
export function getDatabase() {
  if (db)
    return db;

  ensureConfigDir();
  let dbPath = getDatabasePath();

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  return db;
}

/**
 * Close the database connection.
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Run database migrations.
 *
 * @param {Database} database - SQLite database instance
 */
function runMigrations(database) {
  // Create migrations table if it doesn't exist
  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  let migrations = getMigrations();

  for (let migration of migrations) {
    let exists = database.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migration.name);

    if (!exists) {
      console.log(`Running migration: ${migration.name}`);
      database.exec(migration.sql);
      database.prepare('INSERT INTO migrations (name) VALUES (?)').run(migration.name);
    }
  }
}

/**
 * Get the list of migrations to apply.
 *
 * @returns {Array<{name: string, sql: string}>}
 */
function getMigrations() {
  return [
    {
      name: '001_initial_schema',
      sql:  `
        -- Users table
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          encrypted_secret TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX idx_users_username ON users(username);

        -- Agents table (user-scoped)
        CREATE TABLE agents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          api_url TEXT,
          encrypted_api_key TEXT,
          encrypted_config TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, name)
        );

        CREATE INDEX idx_agents_user_id ON agents(user_id);

        -- Sessions table (user-scoped)
        CREATE TABLE sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          system_prompt TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, name)
        );

        CREATE INDEX idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX idx_sessions_agent_id ON sessions(agent_id);

        -- Messages table
        CREATE TABLE messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX idx_messages_session_id ON messages(session_id);

        -- Commands table (user-scoped)
        CREATE TABLE commands (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          handler TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, name)
        );

        CREATE INDEX idx_commands_user_id ON commands(user_id);

        -- Tools table (user-scoped)
        CREATE TABLE tools (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          input_schema TEXT NOT NULL,
          handler TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, name)
        );

        CREATE INDEX idx_tools_user_id ON tools(user_id);
      `,
    },
    {
      name: '002_processes_system',
      sql:  `
        -- Processes table (user-scoped, encrypted content)
        CREATE TABLE processes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          encrypted_content TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, name)
        );

        CREATE INDEX idx_processes_user_id ON processes(user_id);

        -- Add default_processes JSON column to agents table
        ALTER TABLE agents ADD COLUMN default_processes TEXT DEFAULT '[]';
      `,
    },
    {
      name: '003_sessions_archive',
      sql:  `
        -- Add archived flag to sessions for soft-delete
        ALTER TABLE sessions ADD COLUMN archived INTEGER DEFAULT 0;

        -- Index for filtering archived sessions
        CREATE INDEX idx_sessions_archived ON sessions(user_id, archived);
      `,
    },
    {
      name: '004_abilities_system',
      sql:  `
        -- Unified abilities table
        -- Consolidates processes, commands, and functions into one model
        CREATE TABLE abilities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('function', 'process')),
          source TEXT NOT NULL CHECK(source IN ('builtin', 'system', 'user', 'plugin')),
          plugin_name TEXT,
          description TEXT,
          category TEXT,
          tags TEXT,
          encrypted_content TEXT,
          input_schema TEXT,
          auto_approve INTEGER DEFAULT 0,
          auto_approve_policy TEXT DEFAULT 'ask' CHECK(auto_approve_policy IN ('always', 'session', 'never', 'ask')),
          danger_level TEXT DEFAULT 'safe' CHECK(danger_level IN ('safe', 'moderate', 'dangerous')),
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, name)
        );

        CREATE INDEX idx_abilities_user_id ON abilities(user_id);
        CREATE INDEX idx_abilities_type ON abilities(type);
        CREATE INDEX idx_abilities_source ON abilities(source);
        CREATE INDEX idx_abilities_name ON abilities(name);

        -- Pending ability approvals
        CREATE TABLE ability_approvals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
          ability_name TEXT NOT NULL,
          execution_id TEXT NOT NULL UNIQUE,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'denied', 'timeout')),
          request_data TEXT,
          question_type TEXT,
          question_prompt TEXT,
          answer_value TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          resolved_at TEXT
        );

        CREATE INDEX idx_ability_approvals_user_id ON ability_approvals(user_id);
        CREATE INDEX idx_ability_approvals_status ON ability_approvals(status);
        CREATE INDEX idx_ability_approvals_execution_id ON ability_approvals(execution_id);

        -- Session-scoped auto-approvals
        CREATE TABLE session_approvals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          ability_name TEXT NOT NULL,
          approved_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(session_id, ability_name)
        );

        CREATE INDEX idx_session_approvals_session ON session_approvals(session_id);

        -- Add default_abilities column to agents
        ALTER TABLE agents ADD COLUMN default_abilities TEXT DEFAULT '[]';
      `,
    },
    {
      name: '005_messages_hidden',
      sql:  `
        -- Add hidden flag to messages for suppressing system messages from UI
        -- Hidden messages are still sent to the AI but not displayed in chat
        ALTER TABLE messages ADD COLUMN hidden INTEGER DEFAULT 0;

        -- Index for efficient filtering
        CREATE INDEX idx_messages_hidden ON messages(session_id, hidden);
      `,
    },
    {
      name: '006_sessions_status_parent',
      sql:  `
        -- Add status column to sessions for flexible state management
        -- Values: NULL (normal), 'archived', 'agent' (auto-spawned by ability), etc.
        ALTER TABLE sessions ADD COLUMN status TEXT DEFAULT NULL;

        -- Add parent_session_id for session hierarchy (e.g., agent sub-sessions)
        ALTER TABLE sessions ADD COLUMN parent_session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL;

        -- Migrate existing archived flag to status column
        UPDATE sessions SET status = 'archived' WHERE archived = 1;

        -- Index for efficient filtering by status
        CREATE INDEX idx_sessions_status ON sessions(user_id, status);

        -- Index for parent lookups
        CREATE INDEX idx_sessions_parent ON sessions(parent_session_id);
      `,
    },
    {
      name: '007_abilities_applies',
      sql:  `
        -- Add 'applies' field to abilities for conditional auto-application
        -- This is a freeform text field containing a question for the AI to evaluate
        -- Examples:
        --   "Is the user asking about code review?"
        --   "Does this involve file operations?"
        --   "Is the conversation about a specific project?"
        -- The AI interprets this to decide if the ability should auto-apply to context
        ALTER TABLE abilities ADD COLUMN applies TEXT DEFAULT NULL;
      `,
    },
    {
      name: '008_messages_type',
      sql:  `
        -- Add 'type' column to messages for categorizing message types
        -- Types:
        --   'message' - Regular user/assistant messages (default)
        --   'interaction' - Agent interaction requests/responses
        --   'system' - System initialization, startup abilities
        --   'feedback' - Interaction results fed back to agent
        -- This allows filtering in UI while preserving full context for AI
        ALTER TABLE messages ADD COLUMN type TEXT DEFAULT 'message';

        -- Update existing hidden messages to have appropriate types
        UPDATE messages SET type = 'system' WHERE hidden = 1;

        -- Index for efficient filtering by type
        CREATE INDEX idx_messages_type ON messages(session_id, type);
      `,
    },
  ];
}

export default {
  getDatabase,
  closeDatabase,
};
