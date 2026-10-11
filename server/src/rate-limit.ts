/**
 * Minimal in-memory fixed-window rate limiter (low-power friendly: no Redis).
 * Keys are client IPs for login attempts; windows are short and entries are
 * pruned lazily.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {}

  /**
   * Record a hit. Returns null when the request is allowed, or the number of
   * seconds to wait (for Retry-After) when it is blocked.
   */
  hit(key: string, now: number = Date.now()): number | null {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt < now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return null;
    }
    entry.count += 1;
    if (entry.count > this.max) {
      return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    }
    return null;
  }

  /** Clear the key (e.g. after a successful login). */
  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Drop stale windows (housekeeping). */
  prune(now: number = Date.now()): void {
    for (const [key, entry] of this.hits) {
      if (entry.resetAt < now) this.hits.delete(key);
    }
  }
}
