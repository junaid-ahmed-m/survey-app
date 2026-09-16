import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  decryptWithKey,
  encryptWithKey,
  hmacHash,
  maskValue,
  resolveEncryptionKey,
} from './crypto.util';

/**
 * Central place for all reversible / irreversible crypto used by the platform.
 *
 * - `encrypt` / `decrypt` : AES-256-GCM, used for code + coupon values at rest.
 * - `hash`                : deterministic HMAC-SHA256, used for equality lookups
 *                           (a plain hash would still be searchable, the pepper
 *                           makes offline dictionary attacks impractical).
 */
@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);
  private key!: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const raw = this.config.get<string>('security.encryptionKey') ?? '';
    if (!raw) {
      this.logger.warn(
        'CODE_ENCRYPTION_KEY is not set - deriving an ephemeral development key. ' +
          'Data encrypted now will NOT be readable after a restart.',
      );
    } else if (!/^[0-9a-f]{64}$/i.test(raw) && Buffer.from(raw, 'base64').length !== 32) {
      this.logger.warn(
        'CODE_ENCRYPTION_KEY is not a 32-byte hex/base64 value - deriving it with scrypt.',
      );
    }
    this.key = resolveEncryptionKey(raw);
  }

  encrypt(plainText: string): string {
    return encryptWithKey(plainText, this.key);
  }

  decrypt(payload: string): string {
    return decryptWithKey(payload, this.key);
  }

  /** Deterministic, peppered hash used for unique constraints and lookups. */
  hash(value: string): string {
    return hmacHash(value, this.config.get<string>('security.hashSecret') ?? '');
  }

  /** Constant-time comparison helper. */
  safeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  randomToken(bytes = 32): string {
    return crypto.randomBytes(bytes).toString('base64url');
  }

  mask(value: string): string {
    return maskValue(value);
  }
}
