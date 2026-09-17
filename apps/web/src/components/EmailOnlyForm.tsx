import { useState } from 'react';
import { Spinner } from './Spinner';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface Props {
  submitting: boolean;
  error?: string | null;
  onSubmit: (email: string) => void;
  buttonLabel?: string;
}

export function EmailOnlyForm({ submitting, error, onSubmit, buttonLabel = 'Claim my reward' }: Props) {
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const valid = EMAIL_RE.test(email.trim());

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (valid && !submitting) onSubmit(email.trim().toLowerCase());
      }}
    >
      <label className="label" htmlFor="claim-email">
        E-mail address
      </label>
      <input
        id="claim-email"
        className="input py-3.5 text-base"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      {touched && !valid ? (
        <p className="mt-1.5 text-xs text-rose-600">Please enter a valid e-mail address.</p>
      ) : null}
      {error ? <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <p className="mt-4 flex items-center gap-2 text-xs text-slate-400">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" aria-hidden>
          <rect x="4.5" y="10" width="15" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M8 10V7.5a4 4 0 118 0V10" stroke="currentColor" strokeWidth="1.7" />
        </svg>
        We only use your e-mail to send this coupon.
      </p>

      <button type="submit" className="btn-cta mt-4" disabled={submitting}>
        {submitting ? <Spinner /> : null}
        {buttonLabel}
      </button>
    </form>
  );
}
