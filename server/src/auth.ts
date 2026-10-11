import type { Db } from './db.js';
import { hashPassword, verifyPassword } from './password.js';
import type { SessionService } from './sessions.js';

export class OwnerExistsError extends Error {
  constructor() {
    super('owner already exists');
  }
}

/**
 * Single-owner account management (no username — one password rules the app).
 * First-run paths: OWNER_PASSWORD env bootstrap (headless/Docker) or the
 * one-time POST /api/setup endpoint (in-browser). Never both, never a default.
 */
export class OwnerAuth {
  constructor(
    private readonly db: Db,
    private readonly sessions: SessionService,
    private readonly bootstrapPassword?: string,
  ) {}

  /** Seed the owner from the bootstrap password on first run (no-op otherwise). */
  bootstrap(): void {
    if (this.ownerExists() || !this.bootstrapPassword) return;
    this.db
      .prepare('INSERT INTO users (password_hash) VALUES (?)')
      .run(hashPassword(this.bootstrapPassword));
    console.log('owner account bootstrapped from OWNER_PASSWORD');
  }

  ownerExists(): boolean {
    return this.db.prepare('SELECT 1 FROM users LIMIT 1').get() !== undefined;
  }

  get needsSetup(): boolean {
    return !this.ownerExists();
  }

  /** One-time in-browser setup. Throws OwnerExistsError once an owner exists. */
  createOwner(password: string): { userId: number; token: string; expiresAt: string } {
    if (!this.needsSetup) throw new OwnerExistsError();
    const info = this.db
      .prepare('INSERT INTO users (password_hash) VALUES (?)')
      .run(hashPassword(password));
    const userId = Number(info.lastInsertRowid);
    const session = this.sessions.create(userId);
    return { userId, ...session };
  }

  /** Password login. Returns a fresh session, or null on failure. */
  login(password: string): { userId: number; token: string; expiresAt: string } | null {
    this.sessions.purgeExpired();
    const row = this.db
      .prepare('SELECT id, password_hash FROM users LIMIT 1')
      .get() as { id: number; password_hash: string } | undefined;
    if (!row) return null;
    if (!verifyPassword(password, row.password_hash)) return null;
    const session = this.sessions.create(row.id);
    return { userId: row.id, ...session };
  }
}
