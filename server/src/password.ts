import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// OWASP-recommended scrypt parameters (N=2^17, r=8, p=1) — see plan 02 decisions.
const N = 2 ** 17;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 256 * 1024 * 1024;
const SALT_LEN = 16;

const DEFAULT_PARAMS = `N=${N}&r=${R}&p=${P}&keylen=${KEYLEN}`;

/**
 * Hash a password with scrypt (node:crypto, no native dependency).
 * Stored format: scrypt$N=..,r=..,p=..,keylen=..$<saltB64url>$<hashB64url>
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = derive(password, salt, KEYLEN, N, R, P);
  return `scrypt$${DEFAULT_PARAMS}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

/** Verify a password against a stored hash. Returns false on any malformed input. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4) return false;
  const [scheme = '', paramStr = '', saltB64 = '', hashB64 = ''] = parts;
  if (scheme !== 'scrypt') return false;

  const params = new URLSearchParams(paramStr);
  const n = Number(params.get('N'));
  const r = Number(params.get('r'));
  const p = Number(params.get('p'));
  const keylen = Number(params.get('keylen'));
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || !Number.isInteger(keylen)) {
    return false;
  }
  // Sanity caps: the stored value comes from our own DB, but never spend
  // unbounded CPU/memory on a corrupted row.
  if (n < 1024 || n > 2 ** 20 || r < 1 || r > 64 || p < 1 || p > 16 || keylen < 16 || keylen > 256) {
    return false;
  }

  const salt = Buffer.from(saltB64, 'base64url');
  const expected = Buffer.from(hashB64, 'base64url');
  if (salt.length === 0 || salt.length > 256 || expected.length === 0 || expected.length > 256) {
    return false;
  }

  const actual = derive(password, salt, keylen, n, r, p);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function derive(password: string, salt: Buffer, keylen: number, n: number, r: number, p: number): Buffer {
  return scryptSync(password, salt, keylen, { N: n, r, p, maxmem: MAXMEM });
}
