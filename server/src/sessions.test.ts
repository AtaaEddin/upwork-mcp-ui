import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate, type Db } from './db.js';
import { SessionService } from './sessions.js';

function makeDb(): Db {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  db.prepare("INSERT INTO users (password_hash) VALUES ('x')").run();
  return db;
}

function countSessions(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
}

function waitMs(ms: number): void {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // busy wait — tests are short and blocking is fine here
  }
}

describe('SessionService', () => {
  it('creates a session and resolves it via touch (sliding expiry)', () => {
    const db = makeDb();
    const s = new SessionService(db, 60_000);
    const { token, expiresAt } = s.create(1);
    expect(s.touch(token)).toBe(1);
    const remaining = Date.parse(expiresAt) - Date.now();
    expect(remaining).toBeLessThanOrEqual(60_000);
    expect(remaining).toBeGreaterThan(50_000);
  });

  it('rejects unknown or missing tokens', () => {
    const s = new SessionService(makeDb(), 60_000);
    expect(s.touch('nope')).toBeNull();
    expect(s.touch(undefined)).toBeNull();
  });

  it('expires sessions after the TTL and deletes the row', () => {
    const db = makeDb();
    const s = new SessionService(db, 5);
    const { token } = s.create(1);
    expect(s.touch(token)).toBe(1);
    expect(countSessions(db)).toBe(1);
    waitMs(20);
    expect(s.touch(token)).toBeNull();
    expect(countSessions(db)).toBe(0);
  });

  it('revoke deletes the session immediately', () => {
    const db = makeDb();
    const s = new SessionService(db, 60_000);
    const { token } = s.create(1);
    s.revoke(token);
    expect(s.touch(token)).toBeNull();
    expect(countSessions(db)).toBe(0);
  });

  it('purgeExpired removes only expired rows', () => {
    const db = makeDb();
    const short = new SessionService(db, 5);
    const long = new SessionService(db, 60_000);
    const expired = short.create(1);
    const live = long.create(1);
    waitMs(20);
    expect(short.purgeExpired()).toBe(1);
    expect(long.touch(live.token)).toBe(1);
    expect(long.touch(expired.token)).toBeNull();
  });

  it('stores a SHA-256 hash of the token, never the token', () => {
    const db = makeDb();
    const s = new SessionService(db, 60_000);
    const { token } = s.create(1);
    const rows = db.prepare('SELECT token_hash FROM sessions').all() as Array<{ token_hash: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.token_hash).not.toContain(token);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
