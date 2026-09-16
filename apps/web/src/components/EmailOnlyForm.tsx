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
        className="input"
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
      <button type="submit" className="btn-primary mt-4 w-full" disabled={submitting}>
        {submitting ? <Spinner /> : null}
        {buttonLabel}
      </button>
    </form>
  );
}
