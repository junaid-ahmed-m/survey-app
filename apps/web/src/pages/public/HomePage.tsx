import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PublicShell } from '../../components/PublicShell';

const STEPS = [
  { title: 'Scan the code', detail: 'Open your camera and point it at the QR code on the pack.' },
  { title: 'Answer a few questions', detail: 'A short survey — it takes less than a minute.' },
  { title: 'Get your coupon', detail: 'Shown on screen straight away and e-mailed as a backup.' },
];

export default function HomePage() {
  const [code, setCode] = useState('');
  const navigate = useNavigate();

  return (
    <PublicShell
      title="Scan the QR code inside your pack"
      subtitle="Complete a quick survey and receive a coupon for your next purchase"
    >
      <section className="animate-fade-up">
        <p className="section-label">How it works</p>

        <ol className="mt-4 space-y-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="card flex items-start gap-4 p-4 sm:p-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-600">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-brand-700">{step.title}</span>
                <span className="mt-0.5 block text-sm leading-relaxed text-slate-500">
                  {step.detail}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-9 animate-fade-up">
        <p className="section-label">Camera not working?</p>

        <form
          className="card mt-4 p-5 sm:p-6"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = code.trim().toUpperCase();
            if (trimmed) navigate(`/read/${encodeURIComponent(trimmed)}`);
          }}
        >
          <label className="label" htmlFor="manual-code">
            Enter the code printed on the pack
          </label>
          <input
            id="manual-code"
            className="input text-center font-mono text-base uppercase tracking-[0.2em]"
            placeholder="ABCD1234XY"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button type="submit" className="btn-cta mt-4" disabled={!code.trim()}>
            Continue
          </button>
        </form>
      </section>
    </PublicShell>
  );
}
