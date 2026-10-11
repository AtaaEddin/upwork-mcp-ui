import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

type Migration = { name: string; up: (db: Db) => void };

const MIGRATIONS: Migration[] = [
  {
    name: '001_init',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
      `);
    },
  },
  {
    name: '002_upwork_connection',
    up: (db) => {
      // Single-row (id = 1) table: one Upwork connection per deployment.
      // Secrets (OAuth tokens, DCR client info, PKCE verifier, discovery state)
      // are stored AES-256-GCM encrypted (upwork/crypto.ts), never in plaintext.
      db.exec(`
        CREATE TABLE IF NOT EXISTS upwork_connection (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          state TEXT NOT NULL DEFAULT 'disconnected',
          issuer TEXT,
          access_expires_at INTEGER,
          tokens_enc TEXT,
          client_info_enc TEXT,
          verifier_enc TEXT,
          discovery_enc TEXT,
          flow_state TEXT,
          pending_authorize_url TEXT,
          connected_at INTEGER,
          updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        )
      `);
    },
  },
  {
    name: '003_tool_calls',
    up: (db) => {
      // Tool call log (plan 04). PII-safe by construction: args are hashed
      // (sha256 of canonical JSON) and never stored; only ids/times/statuses.
      db.exec(`
        CREATE TABLE IF NOT EXISTS tool_calls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tool TEXT NOT NULL,
          args_hash TEXT NOT NULL,
          status_code INTEGER NOT NULL,
          ms INTEGER NOT NULL,
          error_class TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_tool_calls_created_at
          ON tool_calls (created_at DESC, id DESC);
      `);
    },
  },
  {
    name: '004_upwork_account',
    up: (db) => {
      // Selected Upwork account (plan 06): the org_uid every tool call must
      // carry, plus display fields. Display-only data, never secrets.
      db.exec(`
        CREATE TABLE IF NOT EXISTS upwork_account (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          org_uid TEXT NOT NULL,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          role_label TEXT,
          suspended INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        )
      `);
    },
  },
];

export function openDatabase(dataDir: string): Db {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'app.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

/** Apply pending migrations in order (idempotent). Exported for tests. */
export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
  const applied = new Set(
    (db.prepare('SELECT name FROM migrations').all() as Array<{ name: string }>).map((r) => r.name),
  );
  const insert = db.prepare('INSERT INTO migrations (name) VALUES (?)');
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    const run = db.transaction(() => {
      m.up(db);
      insert.run(m.name);
    });
    run();
  }
}
