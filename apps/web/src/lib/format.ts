export function formatDate(value?: string | Date | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatDateOnly(value?: string | Date | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '∞';
  if (value >= 1e15) return value.toExponential(2);
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  AVAILABLE: 'bg-emerald-50 text-emerald-700',
  UNUSED: 'bg-sky-50 text-sky-700',
  RESERVED: 'bg-amber-50 text-amber-700',
  PAUSED: 'bg-amber-50 text-amber-700',
  USED: 'bg-slate-100 text-slate-600',
  ISSUED: 'bg-brand-50 text-brand-700',
  DISABLED: 'bg-rose-50 text-rose-700',
  EXPIRED: 'bg-rose-50 text-rose-700',
  ARCHIVED: 'bg-slate-100 text-slate-500',
  DRAFT: 'bg-slate-100 text-slate-600',
};

export function statusClass(status: string): string {
  return STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600';
}

export const SURVEY_TYPE_LABELS: Record<string, string> = {
  NATIVE: 'Native survey',
  CONTENTFUL: 'Contentful',
  THIRD_PARTY: 'Third party URL',
};

export function timeLeft(iso?: string | null): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'less than a minute';
  if (minutes === 1) return '1 minute';
  return `${minutes} minutes`;
}
