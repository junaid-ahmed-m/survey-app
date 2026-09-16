import { BadRequestException } from '@nestjs/common';

/**
 * Destination URLs are supplied by admins but the request leaves *our* server,
 * so an unchecked value is a textbook SSRF (OWASP A10). Anything pointing at
 * loopback, link-local, cloud metadata or RFC1918 space is rejected, and the
 * dispatcher additionally refuses to follow redirects.
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

const isPrivateIpv4 = (host: string): boolean => {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return false;
  const [a, b] = parts.map((p) => Number.parseInt(p, 10));
  if (parts.some((p) => Number.parseInt(p, 10) > 255)) return false;
  if (a === 0 || a === 10 || a === 127) return true; // this host / private / loopback
  if (a === 169 && b === 254) return true; // link local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier grade NAT
  if (a >= 224) return true; // multicast / reserved
  return false;
};

/**
 * `allowLocal` is only ever true outside production, so a developer can point a
 * survey at a listener on their own machine while a deployed instance can still
 * never be talked into calling an internal address.
 */
export const assertSafeDestinationUrl = (value: string, allowLocal = false): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Destination URL is not a valid URL.' });
  }

  const reject = (message: string): never => {
    throw new BadRequestException({ code: 'BAD_REQUEST', message });
  };

  if (url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:')) {
    reject('Destination URL must use https.');
  }
  if (url.username || url.password) {
    reject('Destination URL must not embed credentials. Use the secret field instead.');
  }
  if (allowLocal) return url;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    reject('Destination URL must not point at an internal host.');
  }
  if (isPrivateIpv4(host)) {
    reject('Destination URL must not point at a private or loopback address.');
  }
  if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    reject('Destination URL must not point at a private or loopback address.');
  }

  return url;
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const LONG_DIGITS_RE = /\b\d{9,}\b/g;

/**
 * Defence in depth for the "no PII leaves the platform" rule: the e-mail is
 * never added to the payload in the first place, and free-text answers are
 * additionally scrubbed of anything that looks like a contact detail.
 */
export const scrubPii = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return value
      .replace(EMAIL_RE, '[redacted-email]')
      .replace(PHONE_RE, '[redacted-number]')
      .replace(LONG_DIGITS_RE, '[redacted-number]')
      .slice(0, 2000);
  }
  if (Array.isArray(value)) return value.map(scrubPii);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, scrubPii(val)]),
    );
  }
  return value;
};
