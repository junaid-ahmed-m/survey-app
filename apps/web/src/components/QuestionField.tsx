import { SurveyQuestion } from '../lib/types';

interface Props {
  question: SurveyQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}

/** Pulls a leading emoji out of an option label so it can be shown as an icon. */
const LEADING_EMOJI =
  /^(\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*)\s*/u;

function splitLabel(label: string): { emoji: string | null; text: string } {
  const match = LEADING_EMOJI.exec(label);
  if (!match) return { emoji: null, text: label };
  return { emoji: match[1], text: label.slice(match[0].length) };
}

export function QuestionField({ question, value, onChange }: Props) {
  switch (question.type) {
    case 'single_choice':
    case 'multi_choice': {
      const multi = question.type === 'multi_choice';
      const options = question.options ?? [];
      const parsed = options.map((option) => ({ ...option, ...splitLabel(option.label) }));
      // Short, fully illustrated option sets read better as a two-column tile grid.
      const asGrid = parsed.length > 0 && parsed.length <= 4 && parsed.every((o) => o.emoji);
      const selectedValues = Array.isArray(value) ? (value as string[]) : [];

      const isSelected = (optionValue: string) =>
        multi ? selectedValues.includes(optionValue) : value === optionValue;

      const toggle = (optionValue: string) => {
        if (!multi) {
          onChange(optionValue);
          return;
        }
        onChange(
          selectedValues.includes(optionValue)
            ? selectedValues.filter((v) => v !== optionValue)
            : [...selectedValues, optionValue],
        );
      };

      return (
        <div className={asGrid ? 'grid grid-cols-2 gap-3' : 'grid gap-2.5'}>
          {parsed.map((option) => {
            const selected = isSelected(option.value);
            const state = selected ? 'choice-active' : 'choice-idle';

            if (asGrid) {
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => toggle(option.value)}
                  aria-pressed={selected}
                  className={`choice ${state} flex flex-col items-center justify-center gap-2 px-3 py-6 text-center`}
                >
                  <span className="text-3xl leading-none" aria-hidden>
                    {option.emoji}
                  </span>
                  <span className="text-sm font-semibold">{option.text || option.label}</span>
                </button>
              );
            }

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggle(option.value)}
                aria-pressed={selected}
                className={`choice ${state} flex items-center gap-3 px-4 py-3.5`}
              >
                {option.emoji ? (
                  <span className="text-xl leading-none" aria-hidden>
                    {option.emoji}
                  </span>
                ) : (
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center border text-[11px] text-white ${
                      multi ? 'rounded-md' : 'rounded-full'
                    } ${selected ? 'border-brand-600 bg-brand-600' : 'border-slate-300'}`}
                  >
                    {selected ? (multi ? '✓' : <span className="h-2 w-2 rounded-full bg-white" />) : null}
                  </span>
                )}
                <span className="min-w-0 flex-1 font-semibold">{option.text || option.label}</span>
                {option.emoji && selected ? (
                  <span className="shrink-0 text-brand-600" aria-hidden>
                    ✓
                  </span>
                ) : null}
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
                className={`flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-2xl border-2 text-2xl transition ${
                  active
                    ? 'border-gold-400 bg-gold-400/15 text-gold-600'
                    : 'border-slate-200 bg-white text-slate-300 hover:border-brand-300'
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
                  className={`h-12 rounded-xl border-2 text-sm font-bold transition ${
                    selected
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-slate-200 bg-white text-ink-700 hover:border-brand-300'
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
