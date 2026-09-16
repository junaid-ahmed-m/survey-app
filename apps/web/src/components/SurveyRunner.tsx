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
  const progress = Math.round(((step + (isEmailStep ? 1 : 0)) / totalSteps) * 100);

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

  return (
    <div className="card animate-fade-up overflow-hidden">
      <div className="h-1.5 w-full bg-slate-100">
        <div
          className="h-full rounded-r-full bg-brand-600 transition-all duration-300"
          style={{ width: `${Math.max(progress, 6)}%` }}
        />
      </div>

      <div className="p-5 sm:p-7">
        <div className="flex items-center justify-between text-xs font-medium text-slate-400">
          <span className="truncate pr-3">{campaignName}</span>
          <span className="shrink-0">
            Step {step + 1} of {totalSteps}
          </span>
        </div>

        {step === 0 && !isEmailStep ? (
          <div className="mt-3">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{survey.title}</h1>
            {survey.description ? (
              <p className="mt-1 text-sm text-slate-500">{survey.description}</p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6" key={isEmailStep ? 'email' : question?.id}>
          {isEmailStep ? (
            <div className="animate-fade-up">
              <h2 className="text-base font-semibold text-slate-900 sm:text-lg">
                Where should we send your reward?
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                We will show the coupon on screen and e-mail a copy to you.
              </p>
              <div className="mt-5">
                <label className="label" htmlFor="reward-email">
                  E-mail address
                </label>
                <input
                  id="reward-email"
                  className="input"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                {touched && !canContinue ? (
                  <p className="mt-1.5 text-xs text-rose-600">Please enter a valid e-mail address.</p>
                ) : null}
              </div>
            </div>
          ) : question ? (
            <div className="animate-fade-up">
              <h2 className="text-base font-semibold text-slate-900 sm:text-lg">
                {question.label}
                {question.required === false ? (
                  <span className="ml-2 text-xs font-normal text-slate-400">(optional)</span>
                ) : null}
              </h2>
              {question.helpText ? (
                <p className="mt-1 text-sm text-slate-500">{question.helpText}</p>
              ) : null}
              <div className="mt-4">
                <QuestionField
                  question={question}
                  value={answers[question.id]}
                  onChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))}
                />
              </div>
              {touched && !canContinue ? (
                <p className="mt-2 text-xs text-rose-600">Please answer this question to continue.</p>
              ) : null}
            </div>
          ) : null}
        </div>

        {submitError ? (
          <p className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{submitError}</p>
        ) : null}

        <div className="mt-7 flex items-center gap-3">
          {step > 0 ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={submitting}
              onClick={() => {
                setTouched(false);
                setStep((current) => current - 1);
              }}
            >
              Back
            </button>
          ) : null}

          <button
            type="button"
            className="btn-primary flex-1"
            disabled={submitting}
            onClick={handleNext}
          >
            {submitting ? <Spinner /> : null}
            {isEmailStep ? 'Get my reward' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
