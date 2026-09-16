import { ReactNode } from 'react';

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-brand-50 via-slate-50 to-slate-100">
      <header className="px-4 pb-2 pt-6 sm:pt-10">
        <div className="mx-auto flex max-w-xl items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-sm font-bold text-white">
            QR
          </div>
          <span className="text-sm font-semibold tracking-tight text-slate-700">Scan &amp; Reward</span>
        </div>
      </header>

      <main className="px-4 pb-16 pt-4">
        <div className="mx-auto w-full max-w-xl">{children}</div>
      </main>

      <footer className="px-4 pb-8 text-center text-xs text-slate-400">
        Your feedback is stored securely and used only for this campaign.
      </footer>
    </div>
  );
}
