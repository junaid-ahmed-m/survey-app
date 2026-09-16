import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PublicShell } from '../../components/PublicShell';

export default function HomePage() {
  const [code, setCode] = useState('');
  const navigate = useNavigate();

  return (
    <PublicShell>
      <div className="card animate-fade-up p-6 sm:p-8">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-3xl">
          📷
        </div>
        <h1 className="mt-5 text-center text-2xl font-semibold tracking-tight text-slate-900">
          Scan. Share. Get rewarded.
        </h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-slate-600">
          Point your phone camera at the QR code on the pack. It opens this page automatically, asks a few
          quick questions and gives you a coupon.
        </p>

        <ol className="mt-7 space-y-3">
          {[
            'Open your camera and scan the QR code',
            'Answer a handful of short questions',
            'Get your coupon on screen and by e-mail',
          ].map((text, index) => (
            <li key={text} className="flex gap-3 rounded-xl bg-slate-50 px-4 py-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                {index + 1}
              </span>
              <span className="text-sm text-slate-700">{text}</span>
            </li>
          ))}
        </ol>

        <form
          className="mt-7 border-t border-slate-100 pt-6"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = code.trim().toUpperCase();
            if (trimmed) navigate(`/read/${encodeURIComponent(trimmed)}`);
          }}
        >
          <label className="label" htmlFor="manual-code">
            Camera not working? Enter the code manually
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="manual-code"
              className="input font-mono uppercase tracking-widest"
              placeholder="ABCD1234XY"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <button type="submit" className="btn-primary sm:w-auto" disabled={!code.trim()}>
              Continue
            </button>
          </div>
        </form>
      </div>
    </PublicShell>
  );
}
