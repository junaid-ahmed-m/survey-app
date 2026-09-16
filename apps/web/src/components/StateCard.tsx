import { ReactNode } from 'react';

interface StateCardProps {
  tone?: 'error' | 'warning' | 'info' | 'success';
  title: string;
  message: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}

const TONES = {
  error: { ring: 'bg-rose-50 text-rose-600', badge: 'bg-rose-100 text-rose-700' },
  warning: { ring: 'bg-amber-50 text-amber-600', badge: 'bg-amber-100 text-amber-700' },
  info: { ring: 'bg-sky-50 text-sky-600', badge: 'bg-sky-100 text-sky-700' },
  success: { ring: 'bg-emerald-50 text-emerald-600', badge: 'bg-emerald-100 text-emerald-700' },
};

const DEFAULT_ICONS = {
  error: '!',
  warning: '!',
  info: 'i',
  success: '✓',
};

export function StateCard({ tone = 'error', title, message, action, icon }: StateCardProps) {
  const palette = TONES[tone];
  return (
    <div className="card animate-fade-up p-6 text-center sm:p-8">
      <div
        className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full text-2xl font-bold ${palette.ring}`}
      >
        {icon ?? DEFAULT_ICONS[tone]}
      </div>
      <h2 className="mt-4 text-lg font-semibold text-slate-900 sm:text-xl">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-slate-600">{message}</div>
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}
