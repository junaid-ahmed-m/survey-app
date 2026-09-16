import { ReactNode } from 'react';
import { BatchGeneration } from '../../lib/types';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  const toneClass = {
    default: 'text-slate-900',
    good: 'text-emerald-600',
    warn: 'text-amber-600',
    bad: 'text-rose-600',
  }[tone];

  return (
    <div className="card p-4 sm:p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-400">
        ∅
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-700">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Progress of a batch whose codes are being produced in the background. */
export function GenerationProgress({
  generation,
  compact = false,
}: {
  generation: BatchGeneration;
  compact?: boolean;
}) {
  if (generation.status === 'COMPLETE') return null;

  const failed = generation.status === 'FAILED';
  const tone = failed ? 'bg-rose-500' : 'bg-brand-600';
  const label = failed
    ? 'Generation failed'
    : generation.status === 'PENDING'
      ? 'Queued'
      : 'Generating codes';

  return (
    <div className={compact ? '' : 'card p-4 sm:p-5'}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className={`font-medium ${failed ? 'text-rose-700' : 'text-slate-600'}`}>
          {label}
          {failed ? '' : '…'}
        </span>
        <span className="tabular-nums text-slate-500">
          {generation.generated.toLocaleString()} / {generation.total.toLocaleString()}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all duration-500 ${tone}`}
          style={{ width: `${Math.max(generation.percent, failed ? 100 : 2)}%` }}
        />
      </div>
      {failed && generation.error ? (
        <p className="mt-2 text-xs text-rose-600">{generation.error}</p>
      ) : !compact ? (
        <p className="mt-2 text-xs text-slate-400">
          Codes appear as they are produced. You can leave this page — the export unlocks when the
          batch is complete.
        </p>
      ) : null}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  size = 'md',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'md' | 'lg';
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl ${
          size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-lg'
        }`}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
