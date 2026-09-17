import { useState } from 'react';
import { IssuedCoupon } from '../lib/types';
import { formatDateOnly } from '../lib/format';

interface Props {
  coupon: IssuedCoupon;
  email: string;
  emailed: boolean;
}

export function RewardCard({ coupon, email, emailed }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(coupon.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const name = coupon.couponName ?? coupon.couponTypeCode;
  const headline = coupon.value ?? name;
  const subline = coupon.value ? name : null;

  return (
    <div className="animate-fade-up">
      <div className="text-center">
        <span className="mx-auto flex h-16 w-16 animate-pop-in items-center justify-center rounded-full bg-brand-50 text-3xl">
          🎉
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink-900">Congratulations!</h1>
        <p className="mt-1 text-sm text-slate-500">Your reward is ready.</p>
      </div>

      {/* Coupon ticket: teal value half, perforated seam, white code half. */}
      <div className="card mt-6 overflow-hidden">
        <div className="brand-gradient relative px-6 py-7 text-center text-white">
          <span
            aria-hidden
            className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full border-[12px] border-white/10"
          />
          <p className="relative text-[11px] font-bold uppercase tracking-[0.18em] text-brand-50/80">
            Your reward
          </p>
          <p className="relative mt-2 break-words text-4xl font-extrabold tracking-tight sm:text-5xl">
            {headline}
          </p>
          {subline ? <p className="relative mt-2 text-sm text-brand-50/85">{subline}</p> : null}
        </div>

        <div className="relative h-0">
          <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-white" aria-hidden />
          <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-white" aria-hidden />
          <span
            className="absolute inset-x-5 -top-px border-t-2 border-dashed border-slate-200"
            aria-hidden
          />
        </div>

        <div className="px-5 pb-6 pt-7 text-center sm:px-7">
          <p className="section-label">Your coupon code</p>
          <div className="mt-3 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <span className="w-full select-all break-all rounded-xl bg-brand-50 px-4 py-3 font-mono text-lg font-bold tracking-[0.18em] text-ink-900 sm:w-auto sm:text-xl">
              {coupon.code}
            </span>
            <button
              type="button"
              onClick={copy}
              className="shrink-0 rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-brand-600 transition hover:bg-brand-50"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {coupon.expiresAt ? (
            <p className="mt-3 text-xs text-slate-400">
              Valid until {formatDateOnly(coupon.expiresAt)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="panel-teal mt-5 flex items-start gap-3 text-left">
        <span className="mt-0.5 shrink-0 text-brand-600" aria-hidden>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
            <rect x="2.5" y="5" width="19" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M3.5 7l8.5 6 8.5-6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-bold text-brand-700">
            {emailed ? 'E-mail confirmation sent' : 'Save this code now'}
          </span>
          <span className="mt-0.5 block break-words text-sm text-slate-500">
            {emailed ? email : `We could not confirm delivery to ${email}.`}
          </span>
        </span>
      </div>

      <p className="mt-5 flex items-start gap-2 text-left text-xs leading-relaxed text-slate-400">
        <span aria-hidden className="mt-px shrink-0">
          ⓘ
        </span>
        Take a screenshot or check your e-mail. Show this code at participating stores to redeem your
        discount.
      </p>
    </div>
  );
}
