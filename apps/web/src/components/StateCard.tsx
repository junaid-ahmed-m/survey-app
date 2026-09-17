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
  warning: { ring: 'bg-accent-50 text-accent-600', badge: 'bg-accent-100 text-accent-700' },
  info: { ring: 'bg-brand-50 text-brand-600', badge: 'bg-brand-100 text-brand-700' },
  success: { ring: 'bg-brand-50 text-brand-600', badge: 'bg-brand-100 text-brand-700' },
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
        className={`mx-auto flex h-16 w-16 animate-pop-in items-center justify-center rounded-full text-2xl font-bold ${palette.ring}`}
      >
        {icon ?? DEFAULT_ICONS[tone]}
      </div>
      <h2 className="mt-5 text-lg font-bold tracking-tight text-ink-900 sm:text-xl">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-slate-500">{message}</div>
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}
