import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { ApiError } from '../../lib/api';
import { Spinner } from '../../components/Spinner';
import { BrandLogo } from '../../components/BrandLogo';

export default function LoginPage() {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/admin" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError((err as ApiError).message ?? 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="brand-gradient relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <span
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full border-[16px] border-white/10"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-36 -left-28 h-80 w-80 rounded-full border-[16px] border-white/[0.07]"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-7 flex justify-center">
          <BrandLogo className="h-10 w-auto" />
        </div>

        <form className="card p-6 shadow-xl sm:p-7" onSubmit={submit}>
          <h1 className="text-lg font-bold text-ink-900">Admin sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Manage batches, coupons and surveys.</p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="email">
                E-mail
              </label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          </div>

          {error ? (
            <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          ) : null}

          <button type="submit" className="btn-primary mt-6 w-full" disabled={submitting}>
            {submitting ? <Spinner /> : null}
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
