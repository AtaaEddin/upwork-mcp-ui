import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit.js';

const T0 = 1_000_000;

describe('RateLimiter', () => {
  it('allows up to max hits per window, then blocks with retry seconds', () => {
    const rl = new RateLimiter(60_000, 3);
    expect(rl.hit('a', T0)).toBeNull();
    expect(rl.hit('a', T0 + 1)).toBeNull();
    expect(rl.hit('a', T0 + 2)).toBeNull();
    const blocked = rl.hit('a', T0 + 3);
    expect(blocked).not.toBeNull();
    expect(blocked).toBeGreaterThan(0);
  });

  it('recovers after the window elapses', () => {
    const rl = new RateLimiter(60_000, 2);
    rl.hit('a', T0);
    rl.hit('a', T0);
    expect(rl.hit('a', T0)).not.toBeNull();
    expect(rl.hit('a', T0 + 61_000)).toBeNull();
  });

  it('keys are independent', () => {
    const rl = new RateLimiter(60_000, 1);
    expect(rl.hit('a', T0)).toBeNull();
    expect(rl.hit('a', T0)).not.toBeNull();
    expect(rl.hit('b', T0)).toBeNull();
  });

  it('reset clears the key', () => {
    const rl = new RateLimiter(60_000, 2);
    rl.hit('a', T0);
    rl.hit('a', T0);
    expect(rl.hit('a', T0)).not.toBeNull();
    rl.reset('a');
    expect(rl.hit('a', T0)).toBeNull();
  });

  it('prune drops stale windows', () => {
    const rl = new RateLimiter(60_000, 1);
    rl.hit('a', T0);
    rl.prune(T0 + 61_000);
    expect(rl.hit('a', T0 + 61_000)).toBeNull();
  });
});
