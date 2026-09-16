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
      <PublicShell>
        <FullPageLoader label="Restoring your session…" />
      </PublicShell>
    );
  }

  if (phase.kind === 'error') {
    return (
      <PublicShell>
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
      <PublicShell>
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
    <PublicShell>
      <div className="card animate-fade-up p-6 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Almost there!</h1>
        <p className="mt-2 text-sm text-slate-600">
          Enter your e-mail and we will show your coupon here and send you a copy.
        </p>
        <div className="mt-5">
          <EmailOnlyForm
            submitting={submitting}
            error={submitError}
            onSubmit={(email) => void claim(email)}
          />
        </div>
      </div>
    </PublicShell>
  );
}
