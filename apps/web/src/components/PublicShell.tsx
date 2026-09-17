import { ReactNode } from 'react';
import { BrandLogo } from './BrandLogo';

interface Props {
  children: ReactNode;
  /** Optional headline rendered inside the teal hero. */
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Tighter hero for flows whose content carries its own header. */
  compact?: boolean;
}

export function PublicShell({ children, title, subtitle, compact = false }: Props) {
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <header
        className={`brand-gradient relative overflow-hidden px-4 text-white ${
          compact ? 'pb-10 pt-7' : 'pb-12 pt-9 sm:pb-16 sm:pt-12'
        }`}
      >
        {/* Decorative concentric rings, mirrored from the brand key visual. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full border-[14px] border-white/10"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-24 h-72 w-72 rounded-full border-[14px] border-white/[0.07]"
        />

        <div className="relative mx-auto w-full max-w-xl text-center">
          <BrandLogo className="mx-auto h-9 w-auto sm:h-11" />

          {title ? (
            <h1 className="mt-7 text-2xl font-bold leading-snug tracking-tight sm:text-3xl">{title}</h1>
          ) : null}
          {subtitle ? (
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-brand-50/85 sm:text-base">
              {subtitle}
            </p>
          ) : null}
        </div>
      </header>

      <main className="relative z-10 -mt-6 flex-1 rounded-t-3xl bg-white px-4 pb-12 pt-7 sm:-mt-8 sm:rounded-t-4xl sm:pt-9">
        <div className="mx-auto w-full max-w-xl">{children}</div>
      </main>

      <footer className="bg-white px-4 pb-8 pt-2 text-center text-xs text-slate-400">
        Your feedback is stored securely and used only for this campaign.
      </footer>
    </div>
  );
}
