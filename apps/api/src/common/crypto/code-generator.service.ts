import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CHECKSUM_ALPHABET,
  DEFAULT_CHARSET,
  checksumChar,
  normalizeCharset,
  normalizeCode,
  randomBody,
} from './crypto.util';

export { CHECKSUM_ALPHABET, DEFAULT_CHARSET };

export interface CodeGenerationOptions {
  charset?: string;
  length: number;
  prefix?: string;
}

export interface CodeStrength {
  charsetSize: number;
  length: number;
  /** log2 of the search space of the random body. */
  entropyBits: number;
  combinations: number;
  rating: 'weak' | 'fair' | 'strong' | 'very-strong';
}

@Injectable()
export class CodeGeneratorService {
  constructor(private readonly config: ConfigService) {}

  private get secret(): string {
    return this.config.get<string>('security.checksumSecret') ?? '';
  }

  normalizeCharset(charset?: string): string {
    return normalizeCharset(charset);
  }

  normalizePrefix(prefix?: string | null): string {
    return (prefix ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
  }

  /** Strips formatting a user may have typed/pasted. */
  normalizeCode(raw: string): string {
    return normalizeCode(raw);
  }

  /**
   * Checksum character derived with an HMAC secret.
   * Lets us reject ~96.9% of random guesses before they ever touch the database,
   * and makes brute-force enumeration far more expensive when combined with rate limiting.
   */
  hasValidChecksum(code: string): boolean {
    const normalized = normalizeCode(code);
    if (normalized.length < 2) return false;
    return checksumChar(normalized.slice(0, -1), this.secret) === normalized.slice(-1);
  }

  generateOne(options: CodeGenerationOptions): string {
    const charset = normalizeCharset(options.charset);
    const prefix = this.normalizePrefix(options.prefix);
    const length = Math.min(Math.max(options.length ?? 10, 6), 32);
    const body = `${prefix}${randomBody(charset, length)}`;
    return `${body}${checksumChar(body, this.secret)}`;
  }

  /**
   * Generates `count` codes that are unique inside the batch. Database-level
   * uniqueness is additionally guaranteed by the unique index on `Code.codeHash`.
   */
  generateMany(count: number, options: CodeGenerationOptions): string[] {
    const result = new Set<string>();
    const maxAttempts = count * 20 + 100;
    let attempts = 0;
    while (result.size < count && attempts < maxAttempts) {
      result.add(this.generateOne(options));
      attempts += 1;
    }
    if (result.size < count) {
      throw new Error(
        'Unable to generate the requested number of unique codes - increase the code length or charset size.',
      );
    }
    return Array.from(result);
  }

  strength(options: CodeGenerationOptions): CodeStrength {
    const charset = normalizeCharset(options.charset);
    const length = Math.min(Math.max(options.length ?? 10, 6), 32);
    const entropyBits = length * Math.log2(charset.length);
    const rating: CodeStrength['rating'] =
      entropyBits >= 80 ? 'very-strong' : entropyBits >= 60 ? 'strong' : entropyBits >= 40 ? 'fair' : 'weak';
    return {
      charsetSize: charset.length,
      length,
      entropyBits: Math.round(entropyBits * 10) / 10,
      combinations: Math.pow(charset.length, length),
      rating,
    };
  }
}
