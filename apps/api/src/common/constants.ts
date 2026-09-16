export const SURVEY_TYPES = ['NATIVE', 'CONTENTFUL', 'THIRD_PARTY'] as const;
export type SurveyType = (typeof SURVEY_TYPES)[number];

export const BATCH_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const CODE_STATUSES = ['UNUSED', 'USED', 'DISABLED'] as const;
export type CodeStatus = (typeof CODE_STATUSES)[number];

export const COUPON_STATUSES = ['AVAILABLE', 'RESERVED', 'ISSUED', 'EXPIRED'] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];

/**
 * Every admin capability is a permission string. Roles are just named bundles of
 * these, so adding a role never requires a code change.
 */
export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard:view',

  BATCHES_VIEW: 'batches:view',
  BATCHES_MANAGE: 'batches:manage',
  /** See clear-text codes / QR images instead of the masked value. */
  CODES_REVEAL: 'codes:reveal',
  /** Download the code CSV / QR PNG. */
  CODES_EXPORT: 'codes:export',

  COUPONS_VIEW: 'coupons:view',
  COUPONS_MANAGE: 'coupons:manage',
  /** See clear-text coupon codes instead of the masked value. */
  COUPONS_REVEAL: 'coupons:reveal',
  /** Upload / generate coupon inventory. */
  COUPONS_IMPORT: 'coupons:import',

  SURVEYS_VIEW: 'surveys:view',
  SURVEYS_MANAGE: 'surveys:manage',

  RESPONSES_VIEW: 'responses:view',
  /** Download survey responses as CSV. */
  RESPONSES_EXPORT: 'responses:export',
  /** See consumer e-mail addresses instead of the masked value. */
  EMAILS_REVEAL: 'emails:reveal',

  ROLES_VIEW: 'roles:view',
  ROLES_MANAGE: 'roles:manage',
  USERS_VIEW: 'users:view',
  USERS_MANAGE: 'users:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

/** Grouped catalogue used to render the role editor. */
export const PERMISSION_CATALOG: {
  group: string;
  items: { key: Permission; label: string; sensitive?: boolean }[];
}[] = [
  {
    group: 'Dashboard',
    items: [{ key: PERMISSIONS.DASHBOARD_VIEW, label: 'View dashboard' }],
  },
  {
    group: 'Batches & codes',
    items: [
      { key: PERMISSIONS.BATCHES_VIEW, label: 'View batches and codes' },
      { key: PERMISSIONS.BATCHES_MANAGE, label: 'Create and update batches' },
      { key: PERMISSIONS.CODES_REVEAL, label: 'Reveal clear-text codes / QR', sensitive: true },
      { key: PERMISSIONS.CODES_EXPORT, label: 'Download codes (CSV / PNG)', sensitive: true },
    ],
  },
  {
    group: 'Coupons',
    items: [
      { key: PERMISSIONS.COUPONS_VIEW, label: 'View coupon types and inventory' },
      { key: PERMISSIONS.COUPONS_MANAGE, label: 'Create and update coupon types' },
      { key: PERMISSIONS.COUPONS_REVEAL, label: 'Reveal clear-text coupon codes', sensitive: true },
      { key: PERMISSIONS.COUPONS_IMPORT, label: 'Upload coupon inventory', sensitive: true },
    ],
  },
  {
    group: 'Surveys',
    items: [
      { key: PERMISSIONS.SURVEYS_VIEW, label: 'View surveys' },
      { key: PERMISSIONS.SURVEYS_MANAGE, label: 'Create and update surveys' },
    ],
  },
  {
    group: 'Responses',
    items: [
      { key: PERMISSIONS.RESPONSES_VIEW, label: 'View survey responses' },
      { key: PERMISSIONS.RESPONSES_EXPORT, label: 'Download responses (CSV)', sensitive: true },
      { key: PERMISSIONS.EMAILS_REVEAL, label: 'Reveal consumer e-mail addresses', sensitive: true },
    ],
  },
  {
    group: 'Access control',
    items: [
      { key: PERMISSIONS.ROLES_VIEW, label: 'View roles' },
      { key: PERMISSIONS.ROLES_MANAGE, label: 'Create and update roles' },
      { key: PERMISSIONS.USERS_VIEW, label: 'View admin users' },
      { key: PERMISSIONS.USERS_MANAGE, label: 'Invite users and change their role' },
    ],
  },
];

export const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

/** Roles that ship with the platform and cannot be deleted. */
export const SYSTEM_ROLES: { name: string; description: string; permissions: Permission[] }[] = [
  {
    name: SUPER_ADMIN_ROLE,
    description: 'Full access, including clear-text codes, coupons and e-mails.',
    permissions: ALL_PERMISSIONS,
  },
  {
    name: 'CAMPAIGN_MANAGER',
    description: 'Runs campaigns: batches, surveys and coupon stock. No clear-text secrets.',
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.BATCHES_VIEW,
      PERMISSIONS.BATCHES_MANAGE,
      PERMISSIONS.CODES_EXPORT,
      PERMISSIONS.COUPONS_VIEW,
      PERMISSIONS.COUPONS_MANAGE,
      PERMISSIONS.COUPONS_IMPORT,
      PERMISSIONS.SURVEYS_VIEW,
      PERMISSIONS.SURVEYS_MANAGE,
      PERMISSIONS.RESPONSES_VIEW,
      PERMISSIONS.RESPONSES_EXPORT,
    ],
  },
  {
    name: 'VIEWER',
    description: 'Read-only. Everything sensitive stays masked.',
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.BATCHES_VIEW,
      PERMISSIONS.COUPONS_VIEW,
      PERMISSIONS.SURVEYS_VIEW,
      PERMISSIONS.RESPONSES_VIEW,
    ],
  },
];

export const REDEEM_ERRORS = {
  INVALID_CODE: 'INVALID_CODE',
  ALREADY_USED: 'CODE_ALREADY_USED',
  CODE_DISABLED: 'CODE_DISABLED',
  BATCH_INACTIVE: 'BATCH_INACTIVE',
  COUPONS_EXHAUSTED: 'COUPONS_EXHAUSTED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SURVEY_UNAVAILABLE: 'SURVEY_UNAVAILABLE',
} as const;
