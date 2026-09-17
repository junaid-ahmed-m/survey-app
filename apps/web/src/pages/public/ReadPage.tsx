import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, toApiError } from '../../lib/api';
import { RedeemCompleted, RedeemSession } from '../../lib/types';
import { PublicShell } from '../../components/PublicShell';
import { FullPageLoader } from '../../components/Spinner';
import { StateCard } from '../../components/StateCard';
import { SurveyRunner } from '../../components/SurveyRunner';
import { RewardCard } from '../../components/RewardCard';
import { EmailOnlyForm } from '../../components/EmailOnlyForm';

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'survey'; session: RedeemSession }
  | { kind: 'done'; result: RedeemCompleted };

const ERROR_TITLES: Record<string, string> = {
  INVALID_CODE: 'This code is not valid',
  CODE_ALREADY_USED: 'This code has already been used',
  CODE_DISABLED: 'This code is no longer active',
  BATCH_INACTIVE: 'This campaign is not running',
  COUPONS_EXHAUSTED: 'Unable to cater your request',
  SURVEY_UNAVAILABLE: 'Survey unavailable',
  SESSION_EXPIRED: 'Session expired',
  RATE_LIMITED: 'Too many attempts',
};

export default function ReadPage() {
  const { code = '' } = useParams<{ code: string }>();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const verifiedFor = useRef<string | null>(null);

  const verify = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const { data } = await api.post<RedeemSession>('/public/redeem/verify', { code });
      sessionStorage.setItem('redeem.session', data.sessionToken);
      setPhase({ kind: 'survey', session: data });
    } catch (error) {
      const apiError = toApiError(error);
      setPhase({ kind: 'error', code: apiError.code, message: apiError.message });
    }
  }, [code]);

  useEffect(() => {
    // Guard against double invocation (StrictMode / remounts) so one scan never
    // fires two verify requests.
    if (verifiedFor.current === code) return;
    verifiedFor.current = code;
    void verify();
  }, [code, verify]);

  const submit = async (answers: Record<string, unknown>, email: string) => {
    if (phase.kind !== 'survey') return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data } = await api.post<RedeemCompleted>('/public/redeem/complete', {
        sessionToken: phase.session.sessionToken,
        email,
        answers,
      });
      sessionStorage.removeItem('redeem.session');
      setPhase({ kind: 'done', result: data });
    } catch (error) {
      const apiError = toApiError(error);
      if (['SESSION_EXPIRED', 'CODE_ALREADY_USED', 'COUPONS_EXHAUSTED'].includes(apiError.code)) {
        setPhase({ kind: 'error', code: apiError.code, message: apiError.message });
      } else {
        setSubmitError(apiError.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (phase.kind === 'loading') {
    return (
      <PublicShell compact>
        <FullPageLoader label="Checking your code…" />
      </PublicShell>
    );
  }

  if (phase.kind === 'error') {
    const retryable = ['COUPONS_EXHAUSTED', 'SURVEY_UNAVAILABLE', 'RATE_LIMITED', 'NETWORK_ERROR'].includes(
      phase.code,
    );
    return (
      <PublicShell compact>
        <StateCard
          tone={retryable ? 'warning' : 'error'}
          title={ERROR_TITLES[phase.code] ?? 'Something went wrong'}
          message={phase.message}
          action={
            retryable ? (
              <button type="button" className="btn-primary" onClick={() => void verify()}>
                Try again
              </button>
            ) : (
              <Link className="btn-secondary" to="/">
                Back to home
              </Link>
            )
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

  const { session } = phase;

  if (session.survey.type === 'THIRD_PARTY') {
    return (
      <PublicShell compact>
        <div className="animate-fade-up">
          <div className="card overflow-hidden">
            <div className="brand-gradient px-6 py-7 text-center text-white">
              <span className="mx-auto flex h-14 w-14 animate-pop-in items-center justify-center rounded-full bg-white/20 text-2xl">
                ✓
              </span>
              <p className="mt-4 text-xl font-bold tracking-tight">Scan successful!</p>
              <p className="mt-1 text-sm text-brand-50/85">Code verified</p>
            </div>

            <div className="p-5 sm:p-7">
              <div className="panel-teal text-center">
                <p className="section-label">Campaign</p>
                <p className="mt-1 text-base font-bold text-brand-700">{session.campaign.name}</p>
              </div>

              <p className="mt-5 text-sm leading-relaxed text-slate-500">
                Complete the short survey on our partner&apos;s site, then come back here to claim your
                reward.
              </p>

              <a
                className="btn-cta mt-5"
                href={session.survey.url}
                rel="noopener noreferrer nofollow"
              >
                Start Survey
              </a>

              <div className="mt-7 border-t border-slate-100 pt-6">
                <p className="mb-4 text-center text-sm font-semibold text-ink-900">
                  Already finished it? Enter your e-mail to receive your coupon.
                </p>
                <EmailOnlyForm
                  submitting={submitting}
                  error={submitError}
                  onSubmit={(email) => void submit({}, email)}
                  buttonLabel="Get My Coupon"
                />
              </div>
            </div>
          </div>
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell compact>
      <SurveyRunner
        survey={session.survey.survey}
        campaignName={session.campaign.name}
        submitting={submitting}
        submitError={submitError}
        onSubmit={(answers, email) => void submit(answers, email)}
      />
    </PublicShell>
  );
}
