import { SurveyQuestion } from '../lib/types';

interface Props {
  question: SurveyQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}

export function QuestionField({ question, value, onChange }: Props) {
  switch (question.type) {
    case 'single_choice':
      return (
        <div className="grid gap-2">
          {(question.options ?? []).map((option) => {
            const selected = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange(option.value)}
                aria-pressed={selected}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${
                  selected
                    ? 'border-brand-500 bg-brand-50 text-brand-800 ring-2 ring-brand-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    selected ? 'border-brand-600 bg-brand-600' : 'border-slate-300'
                  }`}
                >
                  {selected ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
                </span>
                {option.label}
              </button>
            );
          })}
        </div>
      );

    case 'multi_choice': {
      const selectedValues = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="grid gap-2">
          {(question.options ?? []).map((option) => {
            const selected = selectedValues.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  onChange(
                    selected
                      ? selectedValues.filter((v) => v !== option.value)
                      : [...selectedValues, option.value],
                  )
                }
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${
                  selected
                    ? 'border-brand-500 bg-brand-50 text-brand-800 ring-2 ring-brand-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-white ${
                    selected ? 'border-brand-600 bg-brand-600' : 'border-slate-300'
                  }`}
                >
                  {selected ? '✓' : ''}
                </span>
                {option.label}
              </button>
            );
          })}
        </div>
      );
    }

    case 'rating': {
      const max = question.max ?? 5;
      const min = question.min ?? 1;
      const stars = Array.from({ length: max - min + 1 }, (_, i) => i + min);
      return (
        <div className="flex flex-wrap justify-center gap-2">
          {stars.map((star) => {
            const active = typeof value === 'number' && value >= star;
            return (
              <button
                key={star}
                type="button"
                aria-label={`Rate ${star}`}
                onClick={() => onChange(star)}
                className={`flex h-12 w-12 items-center justify-center rounded-xl border text-2xl transition ${
                  active
                    ? 'border-amber-300 bg-amber-50 text-amber-500'
                    : 'border-slate-200 bg-white text-slate-300 hover:border-slate-300'
                }`}
              >
                ★
              </button>
            );
          })}
        </div>
      );
    }

    case 'nps': {
      const min = question.min ?? 0;
      const max = question.max ?? 10;
      const scores = Array.from({ length: max - min + 1 }, (_, i) => i + min);
      return (
        <div>
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-11">
            {scores.map((score) => {
              const selected = value === score;
              return (
                <button
                  key={score}
                  type="button"
                  onClick={() => onChange(score)}
                  className={`h-11 rounded-lg border text-sm font-semibold transition ${
                    selected
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300'
                  }`}
                >
                  {score}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-slate-400">
            <span>Not likely</span>
            <span>Very likely</span>
          </div>
        </div>
      );
    }

    case 'textarea':
      return (
        <textarea
          className="input min-h-[120px] resize-y"
          maxLength={question.maxLength ?? 500}
          placeholder="Type your answer…"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case 'text':
    default:
      return (
        <input
          className="input"
          maxLength={question.maxLength ?? 200}
          placeholder="Type your answer…"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}
