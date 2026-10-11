import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db.js';

const TOKEN_BYTES = 32;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Opaque session tokens (OWASP session management):
 * - token itself only ever exists in the HttpOnly cookie
 * - DB stores a SHA-256 hash of the token (read-only DB disclosure is useless)
 * - server-side store ⇒ revocation (logout) is instant
 */
export class SessionService {
  constructor(
    private readonly db: Db,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  create(userId: number): { token: string; expiresAt: string } {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs).toISOString();
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(hashToken(token), userId, expiresAt);
    return { token, expiresAt };
  }

  /**
   * Resolve a session token; sliding expiry (refreshes on every valid use).
   * Returns the user id, or null for missing/expired tokens (expired rows are deleted).
   */
  touch(token: string | undefined): number | null {
    if (!token) return null;
    const h = hashToken(token);
    const row = this.db
      .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
      .get(h) as { user_id: number; expires_at: string } | undefined;
    if (!row) return null;
    if (Date.parse(row.expires_at) < Date.now()) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h);
      return null;
    }
    const newExpiry = new Date(Date.now() + this.ttlMs).toISOString();
    this.db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(newExpiry, h);
    return row.user_id;
  }

  revoke(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  /** Delete expired sessions. Returns how many rows were removed. */
  purgeExpired(): number {
    return this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString()).changes;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
