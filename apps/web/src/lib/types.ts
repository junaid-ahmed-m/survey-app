export type SurveyType = 'NATIVE' | 'CONTENTFUL' | 'THIRD_PARTY';

export interface SurveyOption {
  value: string;
  label: string;
}

export interface SurveyQuestion {
  id: string;
  type: 'single_choice' | 'multi_choice' | 'rating' | 'text' | 'textarea' | 'nps';
  label: string;
  helpText?: string;
  required?: boolean;
  options?: SurveyOption[];
  min?: number;
  max?: number;
  maxLength?: number;
}

export interface SurveyDefinition {
  id: string;
  title: string;
  description?: string | null;
  questions: SurveyQuestion[];
  isActive?: boolean;
}

export type ResolvedSurvey =
  | { type: 'NATIVE'; survey: SurveyDefinition }
  | { type: 'CONTENTFUL'; survey: SurveyDefinition }
  | { type: 'THIRD_PARTY'; url: string; returnUrl: string };

export interface RedeemSession {
  status: 'SURVEY_READY';
  sessionToken: string;
  sessionExpiresAt: string;
  campaign: { id: string; name: string; description?: string | null };
  survey: ResolvedSurvey;
}

export interface IssuedCoupon {
  code: string;
  value?: string | null;
  couponTypeCode: string;
  couponName?: string;
  expiresAt?: string | null;
}

export interface RedeemCompleted {
  status: 'COMPLETED';
  emailed: boolean;
  email: string;
  coupon: IssuedCoupon | null;
  completedAt?: string;
}

export interface BatchStats {
  total: number;
  unused: number;
  reserved: number;
  used: number;
  disabled: number;
}

export interface Batch {
  id: string;
  name: string;
  description?: string | null;
  surveyType: SurveyType;
  surveyId?: string | null;
  surveyUrl?: string | null;
  surveyLabel?: string | null;
  couponType: string;
  prefix?: string | null;
  charset: string;
  codeLength: number;
  quantity: number;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  expiresAt?: string | null;
  createdAt: string;
  stats: BatchStats;
  couponsAvailable?: number;
}

export interface BatchCode {
  id: string;
  code: string;
  masked: string;
  status: string;
  scanCount: number;
  usedAt?: string | null;
  createdAt: string;
  url: string;
}

export interface CouponType {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  value?: string | null;
  isActive: boolean;
  inventory: { available: number; reserved: number; issued: number; expired: number; total: number };
}

export interface CouponRow {
  id: string;
  couponTypeCode: string;
  couponCode: string;
  value?: string | null;
  status: string;
  issuedToEmail?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

export interface DashboardStats {
  codes: {
    total: number;
    unused: number;
    reserved: number;
    used: number;
    disabled: number;
    redemptionRate: number;
  };
  coupons: { available: number; reserved: number; issued: number; expired: number };
  batches: number;
  responses: number;
  recentActivity: { id: string; action: string; entityId?: string | null; createdAt: string }[];
}

export interface CodeStrength {
  charsetSize: number;
  length: number;
  entropyBits: number;
  combinations: number;
  rating: 'weak' | 'fair' | 'strong' | 'very-strong';
  samples: string[];
  exampleUrl: string;
}

export interface SurveyResponseRow {
  id: string;
  batchId: string;
  batchName?: string | null;
  surveyType: SurveyType;
  email?: string | null;
  completedAt: string;
  answers: Record<string, unknown>;
}
