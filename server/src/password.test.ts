import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing (scrypt)', () => {
  it('round-trips a password', () => {
    const h = hashPassword('correct-horse-9');
    expect(verifyPassword('correct-horse-9', h)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const h = hashPassword('correct-horse-9');
    expect(verifyPassword('correct-horse-10', h)).toBe(false);
  });

  it('stores scrypt params and a salt (self-describing format)', () => {
    const h = hashPassword('whatever');
    const parts = h.split('$');
    expect(parts.length).toBe(4);
    expect(parts[0]).toBe('scrypt');
    expect(parts[1]).toContain('N=131072');
    expect(Buffer.from(parts[2]!, 'base64url').length).toBe(16);
  });

  it('two hashes of the same password differ (random salt)', () => {
    const a = hashPassword('same-password');
    const b = hashPassword('same-password');
    expect(a).not.toBe(b);
  });

  it('rejects malformed stored values', () => {
    expect(verifyPassword('x', 'garbage')).toBe(false);
    expect(verifyPassword('x', 'pbkdf2$a$b$c')).toBe(false);
    expect(verifyPassword('x', 'scrypt$N=abc$aa$bb')).toBe(false);
    expect(verifyPassword('x', 'scrypt$N=131072,r=8,p=1,keylen=64$')).toBe(false); // empty salt
  });

  it('rejects implausible params from a corrupted row', () => {
    const h = hashPassword('x');
    const [, , salt, hash] = h.split('$');
    const evil = `scrypt$N=4294967296,r=8,p=1,keylen=64$${salt}$${hash}`;
    expect(verifyPassword('x', evil)).toBe(false);
  });
});
