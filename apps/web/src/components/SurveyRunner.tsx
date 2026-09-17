import { useMemo, useState } from 'react';
import { SurveyDefinition } from '../lib/types';
import { QuestionField } from './QuestionField';
import { Spinner } from './Spinner';

interface Props {
  survey: SurveyDefinition;
  campaignName: string;
  submitting: boolean;
  submitError?: string | null;
  onSubmit: (answers: Record<string, unknown>, email: string) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function SurveyRunner({ survey, campaignName, submitting, submitError, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);

  const totalSteps = survey.questions.length + 1;
  const isEmailStep = step === survey.questions.length;
  const question = survey.questions[step];

  const canContinue = useMemo(() => {
    if (isEmailStep) return EMAIL_RE.test(email.trim());
    if (!question) return false;
    return question.required === false || isAnswered(answers[question.id]);
  }, [answers, email, isEmailStep, question]);

  const handleNext = () => {
    setTouched(true);
    if (!canContinue) return;
    setTouched(false);
    if (isEmailStep) {
      onSubmit(answers, email.trim().toLowerCase());
      return;
    }
    setStep((current) => current + 1);
  };

  const goBack = () => {
    setTouched(false);
    setStep((current) => current - 1);
  };

  return (
    <div className="animate-fade-up">
      <div className="card overflow-hidden">
        {/* Teal header bar with the back control and the campaign name. */}
        <div className="brand-gradient flex items-center gap-3 px-4 py-3.5 text-white">
          {step > 0 ? (
            <button
              type="button"
              aria-label="Back"
              disabled={submitting}
              onClick={goBack}
              className="-ml-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg transition hover:bg-white/15 disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
                <path
                  d="M15 5l-7 7 7 7"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : (
            <span className="h-9 w-9 shrink-0" aria-hidden />
          )}
          <p className="min-w-0 flex-1 truncate text-center text-sm font-semibold">
            {isEmailStep ? 'Almost there!' : campaignName}
          </p>
          <span className="h-9 w-9 shrink-0" aria-hidden />
        </div>

        {/* Segmented progress: one segment per step. */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
          <div className="flex min-w-0 flex-1 gap-1.5" role="presentation">
            {Array.from({ length: totalSteps }, (_, index) => (
              <span
                key={index}
                className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                  index <= step ? 'bg-brand-600' : 'bg-slate-200'
                }`}
              />
            ))}
          </div>
          <span className="shrink-0 text-xs font-bold tabular-nums text-brand-600">
            {step + 1}/{totalSteps}
          </span>
        </div>

        <div className="p-5 sm:p-7">
          {step === 0 && !isEmailStep ? (
            <div className="mb-6">
              <h1 className="text-lg font-bold tracking-tight text-ink-900 sm:text-xl">
                {survey.title}
              </h1>
              {survey.description ? (
                <p className="mt-1 text-sm text-slate-500">{survey.description}</p>
              ) : null}
            </div>
          ) : null}

          <div key={isEmailStep ? 'email' : question?.id}>
            {isEmailStep ? (
              <div className="animate-fade-up text-center">
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
                <h2 className="mt-5 text-lg font-bold text-ink-900 sm:text-xl">
                  Where should we send your coupon?
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-500">
                  We&apos;ll e-mail your coupon code as a backup so you never lose it.
                </p>

                <div className="mt-6 text-left">
                  <label className="label" htmlFor="reward-email">
                    E-mail address
                  </label>
                  <input
                    id="reward-email"
                    className="input py-3.5 text-base"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                  {touched && !canContinue ? (
                    <p className="mt-1.5 text-xs text-rose-600">
                      Please enter a valid e-mail address.
                    </p>
                  ) : null}
                </div>

                <p className="mt-5 flex items-center justify-center gap-2 text-xs text-slate-400">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" aria-hidden>
                    <rect
                      x="4.5"
                      y="10"
                      width="15"
                      height="10"
                      rx="2"
                      stroke="currentColor"
                      strokeWidth="1.7"
                    />
                    <path d="M8 10V7.5a4 4 0 118 0V10" stroke="currentColor" strokeWidth="1.7" />
                  </svg>
                  We only use your e-mail to send this coupon.
                </p>
              </div>
            ) : question ? (
              <div className="animate-fade-up">
                <h2 className="text-lg font-bold leading-snug text-ink-900 sm:text-xl">
                  {question.label}
                  {question.required === false ? (
                    <span className="ml-2 text-xs font-normal text-slate-400">(optional)</span>
                  ) : null}
                </h2>
                <p className="mt-1.5 text-sm text-slate-500">
                  {question.helpText ?? `Question ${step + 1} of ${survey.questions.length}`}
                </p>
                <div className="mt-5">
                  <QuestionField
                    question={question}
                    value={answers[question.id]}
                    onChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))}
                  />
                </div>
                {touched && !canContinue ? (
                  <p className="mt-3 text-xs text-rose-600">
                    Please answer this question to continue.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {submitError ? (
            <p className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{submitError}</p>
          ) : null}
        </div>
      </div>

      {/* Sticky call to action so it stays reachable on small screens. */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-5 border-t border-slate-100 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.875rem)] pt-3.5 backdrop-blur sm:mx-0 sm:rounded-b-2xl sm:border-0 sm:bg-transparent sm:px-0 sm:backdrop-blur-none">
        <button type="button" className="btn-cta" disabled={submitting} onClick={handleNext}>
          {submitting ? <Spinner /> : null}
          {isEmailStep ? 'Get My Coupon' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
