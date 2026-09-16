/** Mirror of PERMISSIONS in apps/api/src/common/constants.ts. */
export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard:view',

  BATCHES_VIEW: 'batches:view',
  BATCHES_MANAGE: 'batches:manage',
  CODES_REVEAL: 'codes:reveal',
  CODES_EXPORT: 'codes:export',

  COUPONS_VIEW: 'coupons:view',
  COUPONS_MANAGE: 'coupons:manage',
  COUPONS_REVEAL: 'coupons:reveal',
  COUPONS_IMPORT: 'coupons:import',

  SURVEYS_VIEW: 'surveys:view',
  SURVEYS_MANAGE: 'surveys:manage',

  RESPONSES_VIEW: 'responses:view',
  RESPONSES_EXPORT: 'responses:export',
  EMAILS_REVEAL: 'emails:reveal',

  EVENTS_VIEW: 'events:view',
  EVENTS_MANAGE: 'events:manage',

  ROLES_VIEW: 'roles:view',
  ROLES_MANAGE: 'roles:manage',
  USERS_VIEW: 'users:view',
  USERS_MANAGE: 'users:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface PermissionGroup {
  group: string;
  items: { key: Permission; label: string; sensitive?: boolean }[];
}
