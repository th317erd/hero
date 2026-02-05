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
  ];
}

export default {
  getDatabase,
  closeDatabase,
};
