import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, toApiError } from '../../lib/api';
import { RedeemCompleted, RedeemSession } from '../../lib/types';
import { PublicShell } from '../../components/PublicShell';
import { FullPageLoader } from '../../components/Spinner';
import { StateCard } from '../../components/StateCard';
import { RewardCard } from '../../components/RewardCard';
import { EmailOnlyForm } from '../../components/EmailOnlyForm';

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'claim'; session: RedeemSession }
  | { kind: 'done'; result: RedeemCompleted };

/**
 * Landing page a third-party survey provider redirects back to:
 *   /survey/return?session=<sessionToken>
 */
export default function SurveyReturnPage() {
  const [params] = useSearchParams();
  const token = params.get('session') ?? sessionStorage.getItem('redeem.session') ?? '';
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setPhase({ kind: 'error', message: 'This link is missing its session reference.' });
      return;
    }
    api
      .get<RedeemSession | RedeemCompleted>(`/public/redeem/session/${encodeURIComponent(token)}`)
      .then(({ data }) => {
        if (data.status === 'COMPLETED') {
          setPhase({ kind: 'done', result: data });
        } else {
          setPhase({ kind: 'claim', session: data });
        }
      })
      .catch((error) => setPhase({ kind: 'error', message: toApiError(error).message }));
  }, [token]);

  const claim = async (email: string) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data } = await api.post<RedeemCompleted>('/public/redeem/complete', {
        sessionToken: token,
        email,
        answers: { source: 'third_party' },
      });
      sessionStorage.removeItem('redeem.session');
      setPhase({ kind: 'done', result: data });
    } catch (error) {
      setSubmitError(toApiError(error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (phase.kind === 'loading') {
    return (
      <PublicShell compact>
        <FullPageLoader label="Restoring your session…" />
      </PublicShell>
    );
  }

  if (phase.kind === 'error') {
    return (
      <PublicShell compact>
        <StateCard
          title="We could not restore your session"
          message={phase.message}
          action={
            <Link className="btn-secondary" to="/">
              Back to home
            </Link>
          }
        />
      </PublicShell>
    );
  }

  if (phase.kind === 'done') {
    return (
      <PublicShell compact>
        {phase.result.coupon ? (
          <RewardCard
            coupon={phase.result.coupon}
            email={phase.result.email}
            emailed={phase.result.emailed}
          />
        ) : (
          <StateCard tone="success" title="All done" message="Thanks for completing the survey." />
        )}
      </PublicShell>
    );
  }

  return (
    <PublicShell compact>
      <div className="card animate-fade-up p-6 sm:p-8">
        <div className="text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" aria-hidden>
              <rect
                x="2.5"
                y="5"
                width="19"
                height="14"
                rx="2.5"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M3.5 7l8.5 6 8.5-6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <h1 className="mt-5 text-xl font-bold tracking-tight text-ink-900">Almost there!</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-500">
            Where should we send your coupon? We&apos;ll show it here and e-mail a copy as a backup.
          </p>
        </div>
        <div className="mt-6">
          <EmailOnlyForm
            submitting={submitting}
            error={submitError}
            onSubmit={(email) => void claim(email)}
            buttonLabel="Get My Coupon"
          />
        </div>
      </div>
    </PublicShell>
  );
}
