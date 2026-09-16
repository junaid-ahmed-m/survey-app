import * as crypto from 'crypto';

export const ALGORITHM = 'aes-256-gcm';
export const IV_LENGTH = 12;
export const AUTH_TAG_LENGTH = 16;

/** Unambiguous Crockford-style alphabet (no 0/O/1/I to avoid transcription errors). */
export const DEFAULT_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Alphabet used for the trailing checksum character.
 * Fixed on purpose: verification must work without knowing which batch (and
 * therefore which charset) a code belongs to.
 */
export const CHECKSUM_ALPHABET = DEFAULT_CHARSET;

/** Accepts 32-byte hex, 32-byte base64 or any passphrase (derived with scrypt). */
export function resolveEncryptionKey(raw: string): Buffer {
  if (!raw) return crypto.randomBytes(32);
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  const asBase64 = Buffer.from(raw, 'base64');
  if (asBase64.length === 32) return asBase64;
  return crypto.scryptSync(raw, 'qr-survey-rewards', 32);
}

export function encryptWithKey(plainText: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptWithKey(payload: string, key: Buffer): string {
  const [ivPart, tagPart, dataPart] = payload.split('.');
  if (!ivPart || !tagPart || !dataPart) throw new Error('Malformed ciphertext payload');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64'), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

export function hmacHash(value: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

export function checksumChar(payload: string, secret: string): string {
  const digest = crypto.createHmac('sha256', secret).update(payload).digest();
  return CHECKSUM_ALPHABET[digest[0] % CHECKSUM_ALPHABET.length];
}

export function normalizeCharset(charset?: string): string {
  const source = (charset ?? DEFAULT_CHARSET).toUpperCase();
  const unique = Array.from(new Set(source.split(''))).filter((c) => /[A-Z0-9]/.test(c));
  return unique.length >= 2 ? unique.join('') : DEFAULT_CHARSET;
}

export function normalizeCode(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

/** crypto.randomInt is uniform (rejection sampling) - no modulo bias. */
export function randomBody(charset: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += charset[crypto.randomInt(0, charset.length)];
  }
  return out;
}

export function maskValue(value: string): string {
  if (value.length <= 4) return '*'.repeat(value.length);
  const visible = Math.min(4, Math.floor(value.length / 3));
  return `${value.slice(0, visible)}${'*'.repeat(value.length - visible - 2)}${value.slice(-2)}`;
}
