import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION_PREFIX = 'v1.';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Derive the 256-bit AES-GCM key from the app secret.
 * The salt is fixed (not per-record): the app secret already carries the entropy
 * (32+ chars, required in production), so a KDF iteration count buys nothing here.
 */
function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(`upwork-mcp-ui/oauth/v1|${secret}`).digest();
}

/**
 * Encrypt a JSON-serializable value as `v1.<base64(nonce ‖ tag ‖ ciphertext)>` (AES-256-GCM).
 * The auth tag is included in the blob: any tampered/undecryptable blob fails decryption.
 */
export function encryptJson(secret: string, value: unknown): string {
  const key = deriveKey(secret);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION_PREFIX}${Buffer.concat([nonce, tag, ciphertext]).toString('base64')}`;
}

/**
 * Decrypt a blob produced by {@link encryptJson}.
 * Throws on version mismatch, malformed base64, auth-tag failure, or bad JSON.
 */
export function decryptJson<T>(secret: string, blob: string): T {
  if (!blob.startsWith(VERSION_PREFIX)) throw new Error('unknown encryption version');
  const raw = Buffer.from(blob.slice(VERSION_PREFIX.length), 'base64');
  if (raw.length < NONCE_BYTES + TAG_BYTES + 1) throw new Error('blob too short');
  const nonce = raw.subarray(0, NONCE_BYTES);
  const tag = raw.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}
