export const SURVEY_TYPES = ['NATIVE', 'CONTENTFUL', 'THIRD_PARTY'] as const;
export type SurveyType = (typeof SURVEY_TYPES)[number];

export const BATCH_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const CODE_STATUSES = ['UNUSED', 'RESERVED', 'USED', 'DISABLED'] as const;
export type CodeStatus = (typeof CODE_STATUSES)[number];

export const COUPON_STATUSES = ['AVAILABLE', 'RESERVED', 'ISSUED', 'EXPIRED'] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];

export const ADMIN_ROLES = ['ADMIN', 'VIEWER'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const REDEEM_ERRORS = {
  INVALID_CODE: 'INVALID_CODE',
  ALREADY_USED: 'CODE_ALREADY_USED',
  CODE_DISABLED: 'CODE_DISABLED',
  BATCH_INACTIVE: 'BATCH_INACTIVE',
  COUPONS_EXHAUSTED: 'COUPONS_EXHAUSTED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SURVEY_UNAVAILABLE: 'SURVEY_UNAVAILABLE',
} as const;
