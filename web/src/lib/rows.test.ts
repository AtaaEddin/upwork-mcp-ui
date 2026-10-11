import { describe, expect, it } from 'vitest';
import { connectsBalanceOf, mapListResult } from './rows.js';

describe('mapListResult (plan 06)', () => {
  it('counts items from named wrappers and picks titles/subs defensively', () => {
    const res = mapListResult({
      invitations: [
        { title: 'Invitation A', client_name: 'Client A' },
        { name: 'Invitation B' },
      ],
    });
    expect(res.count).toBe(2);
    expect(res.items[0]?.title).toBe('Invitation A');
    expect(res.items[0]?.sub).toBe('Client A');
    expect(res.items[1]?.title).toBe('Invitation B');
  });

  it('accepts top-level arrays and empty payloads', () => {
    const arr = mapListResult([{ name: 'Only' }]);
    expect(arr.count).toBe(1);
    expect(mapListResult(null).count).toBe(0);
    expect(mapListResult({}).count).toBe(0);
  });
});

describe('connectsBalanceOf (plan 06)', () => {
  it('finds the Connects balance in the plausible fields', () => {
    expect(connectsBalanceOf({ balance: 5 })).toBe(5);
    expect(connectsBalanceOf({ wallet: { balance: 3 } })).toBe(3);
    expect(connectsBalanceOf({ credits_balance: 9 })).toBe(9);
    expect(connectsBalanceOf({})).toBeNull();
    expect(connectsBalanceOf(null)).toBeNull();
  });
});
