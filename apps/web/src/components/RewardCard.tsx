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

  return (
    <div className="card animate-fade-up overflow-hidden">
      <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-6 py-8 text-center text-white">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-3xl">
          🎉
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight sm:text-2xl">Thanks for your feedback!</h1>
        <p className="mt-1 text-sm text-brand-100">Here is your reward.</p>
      </div>

      <div className="p-5 sm:p-7">
        <div className="rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50 p-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">
            {coupon.couponName ?? coupon.couponTypeCode}
            {coupon.value ? ` · ${coupon.value}` : ''}
          </p>
          <p className="mt-2 select-all break-all font-mono text-2xl font-bold tracking-[0.2em] text-slate-900">
            {coupon.code}
          </p>
          {coupon.expiresAt ? (
            <p className="mt-2 text-xs text-slate-500">Valid until {formatDateOnly(coupon.expiresAt)}</p>
          ) : null}
        </div>

        <button type="button" className="btn-primary mt-4 w-full" onClick={copy}>
          {copied ? 'Copied!' : 'Copy coupon code'}
        </button>

        <p className="mt-4 text-center text-sm text-slate-500">
          {emailed ? (
            <>
              A copy has been sent to <span className="font-medium text-slate-700">{email}</span>.
            </>
          ) : (
            <>
              Save this code now — we could not confirm delivery to{' '}
              <span className="font-medium text-slate-700">{email}</span>.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
