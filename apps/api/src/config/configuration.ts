export type AppConfig = ReturnType<typeof configuration>;

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export const configuration = () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: toInt(process.env.PORT, 3000),
  publicAppUrl: (process.env.PUBLIC_APP_URL ?? 'http://localhost:5173').replace(/\/+$/, ''),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  security: {
    encryptionKey: process.env.CODE_ENCRYPTION_KEY ?? '',
    hashSecret: process.env.CODE_HASH_SECRET ?? 'dev-code-hash-secret',
    checksumSecret: process.env.CODE_CHECKSUM_SECRET ?? 'dev-code-checksum-secret',
  },

  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-jwt-secret',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  },

  redeem: {
    sessionTtlMinutes: toInt(process.env.REDEEM_SESSION_TTL_MINUTES, 30),
  },

  rateLimit: {
    ttlSeconds: toInt(process.env.RATE_LIMIT_TTL_SECONDS, 60),
    limit: toInt(process.env.RATE_LIMIT_MAX, 60),
    redeemTtlSeconds: toInt(process.env.REDEEM_RATE_LIMIT_TTL_SECONDS, 60),
    redeemLimit: toInt(process.env.REDEEM_RATE_LIMIT_MAX, 10),
  },

  contentful: {
    spaceId: process.env.CONTENTFUL_SPACE_ID ?? '',
    environment: process.env.CONTENTFUL_ENVIRONMENT ?? 'master',
    accessToken: process.env.CONTENTFUL_ACCESS_TOKEN ?? '',
  },

  mail: {
    host: process.env.SMTP_HOST ?? '',
    port: toInt(process.env.SMTP_PORT, 587),
    secure: toBool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from: process.env.MAIL_FROM ?? 'Rewards <no-reply@example.com>',
  },

  seed: {
    adminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com',
    adminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345',
  },
});
