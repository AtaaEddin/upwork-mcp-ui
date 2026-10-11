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
