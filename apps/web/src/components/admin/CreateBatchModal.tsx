import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toApiError } from '../../lib/api';
import { Batch, CodeStrength, CouponType, SurveyDefinition } from '../../lib/types';
import { Modal } from './ui';
import { Spinner } from '../Spinner';
import { formatCompact } from '../../lib/format';

const DEFAULT_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Above this the API queues the batch and a worker fills it in the background. */
const INLINE_GENERATION_LIMIT = 10_000;

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FormState {
  name: string;
  description: string;
  sku: string;
  surveyType: 'NATIVE' | 'CONTENTFUL' | 'THIRD_PARTY';
  surveyId: string;
  surveyUrl: string;
  couponType: string;
  prefix: string;
  charset: string;
  codeLength: number;
  quantity: number;
  expiresAt: string;
}

const INITIAL: FormState = {
  name: '',
  description: '',
  sku: '',
  surveyType: 'NATIVE',
  surveyId: '',
  surveyUrl: '',
  couponType: '',
  prefix: '',
  charset: DEFAULT_CHARSET,
  codeLength: 10,
  quantity: 100,
  expiresAt: '',
};

const RATING_STYLES: Record<string, string> = {
  weak: 'bg-rose-50 text-rose-700',
  fair: 'bg-amber-50 text-amber-700',
  strong: 'bg-emerald-50 text-emerald-700',
  'very-strong': 'bg-emerald-50 text-emerald-700',
};

export function CreateBatchModal({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [strength, setStrength] = useState<CodeStrength | null>(null);

  const { data: couponTypes } = useQuery({
    queryKey: ['admin', 'coupon-types'],
    queryFn: async () => (await api.get<CouponType[]>('/admin/coupons/types')).data,
    enabled: open,
  });

  const { data: surveys } = useQuery({
    queryKey: ['admin', 'surveys'],
    queryFn: async () => (await api.get<SurveyDefinition[]>('/admin/surveys')).data,
    enabled: open,
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      api
        .post<CodeStrength>('/admin/batches/preview', {
          prefix: form.prefix || undefined,
          charset: form.charset || undefined,
          codeLength: Number(form.codeLength) || 10,
        })
        .then(({ data }) => setStrength(data))
        .catch(() => setStrength(null));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, form.prefix, form.charset, form.codeLength]);

  useEffect(() => {
    if (open) {
      setForm(INITIAL);
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        surveyType: form.surveyType,
        couponType: form.couponType,
        codeLength: Number(form.codeLength),
        quantity: Number(form.quantity),
        charset: form.charset || undefined,
      };
      if (form.description.trim()) payload.description = form.description.trim();
      if (form.sku.trim()) payload.sku = form.sku.trim().toUpperCase();
      if (form.prefix.trim()) payload.prefix = form.prefix.trim().toUpperCase();
      if (form.expiresAt) payload.expiresAt = new Date(form.expiresAt).toISOString();
      if (form.surveyType === 'THIRD_PARTY') payload.surveyUrl = form.surveyUrl.trim();
      else payload.surveyId = form.surveyId.trim();

      return (await api.post<Batch>('/admin/batches', payload)).data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'batches'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
      onClose();
    },
    onError: (err) => setError(toApiError(err).message),
  });

  const availableForType = couponTypes?.find((t) => t.code === form.couponType)?.inventory.available ?? 0;
  const shortInventory = form.couponType !== '' && availableForType < Number(form.quantity);
  const queued = Number(form.quantity) > INLINE_GENERATION_LIMIT;

  return (
    <Modal open={open} title="Generate a new batch of codes" onClose={onClose} size="lg">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          mutation.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="batch-name">
              Batch name
            </label>
            <input
              id="batch-name"
              className="input"
              required
              minLength={2}
              placeholder="Diwali pack inserts — North zone"
              value={form.name}
              onChange={(event) => set('name', event.target.value)}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label" htmlFor="batch-description">
              Description <span className="text-slate-400">(optional)</span>
            </label>
            <input
              id="batch-description"
              className="input"
              value={form.description}
              onChange={(event) => set('description', event.target.value)}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label" htmlFor="batch-sku">
              Product SKU <span className="text-slate-400">(optional)</span>
            </label>
            <input
              id="batch-sku"
              className="input uppercase"
              maxLength={64}
              pattern="[A-Za-z0-9._/-]*"
              placeholder="PMP-PANTS-L-42"
              value={form.sku}
              onChange={(event) => set('sku', event.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">
              The product these codes are printed on. Shown on exports and used to search batches.
            </p>
          </div>
        </div>

        <fieldset className="rounded-2xl border border-slate-200 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Survey
          </legend>

          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                { value: 'NATIVE', label: 'Native', hint: 'Built-in survey' },
                { value: 'CONTENTFUL', label: 'Contentful', hint: 'Fetched from CMS' },
                { value: 'THIRD_PARTY', label: 'Third party', hint: 'External URL' },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => set('surveyType', option.value)}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${
                  form.surveyType === option.value
                    ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <span className="block text-sm font-semibold text-slate-800">{option.label}</span>
                <span className="block text-xs text-slate-500">{option.hint}</span>
              </button>
            ))}
          </div>

          <div className="mt-4">
            {form.surveyType === 'NATIVE' ? (
              <>
                <label className="label" htmlFor="survey-id">
                  Native survey
                </label>
                <select
                  id="survey-id"
                  className="input"
                  required
                  value={form.surveyId}
                  onChange={(event) => set('surveyId', event.target.value)}
                >
                  <option value="">Select a survey…</option>
                  {surveys?.map((survey) => (
                    <option key={survey.id} value={survey.id}>
                      {survey.title}
                    </option>
                  ))}
                </select>
              </>
            ) : form.surveyType === 'CONTENTFUL' ? (
              <>
                <label className="label" htmlFor="contentful-id">
                  Contentful entry id
                </label>
                <input
                  id="contentful-id"
                  className="input font-mono"
                  required
                  placeholder="6f2Xa9bQqLmN..."
                  value={form.surveyId}
                  onChange={(event) => set('surveyId', event.target.value)}
                />
              </>
            ) : (
              <>
                <label className="label" htmlFor="survey-url">
                  Third party survey URL
                </label>
                <input
                  id="survey-url"
                  className="input"
                  type="url"
                  required
                  placeholder="https://forms.partner.com/s/abc"
                  value={form.surveyUrl}
                  onChange={(event) => set('surveyUrl', event.target.value)}
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  We append <code className="rounded bg-slate-100 px-1">ref</code> and{' '}
                  <code className="rounded bg-slate-100 px-1">return_url</code> so the user comes back to
                  claim the coupon.
                </p>
              </>
            )}
          </div>
        </fieldset>

        <fieldset className="rounded-2xl border border-slate-200 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Reward
          </legend>
          <label className="label" htmlFor="coupon-type">
            Coupon type
          </label>
          <select
            id="coupon-type"
            className="input"
            required
            value={form.couponType}
            onChange={(event) => set('couponType', event.target.value)}
          >
            <option value="">Select a coupon type…</option>
            {couponTypes?.map((type) => (
              <option key={type.code} value={type.code}>
                {type.name} ({type.inventory.available} in stock)
              </option>
            ))}
          </select>
          {shortInventory ? (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Only {availableForType} coupons in stock for {form.quantity} codes. Codes stay unused once stock
              runs out and users are asked to try again later.
            </p>
          ) : null}
        </fieldset>

        <fieldset className="rounded-2xl border border-slate-200 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Code generation
          </legend>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="quantity">
                Quantity
              </label>
              <input
                id="quantity"
                className="input"
                type="number"
                min={1}
                max={1000000}
                required
                value={form.quantity}
                onChange={(event) => set('quantity', Number(event.target.value))}
              />
              {queued ? (
                <p className="mt-1 text-xs text-slate-500">
                  Generated in the background — the batch is created straight away and fills up as
                  the worker runs.
                </p>
              ) : null}
            </div>
            <div>
              <label className="label" htmlFor="prefix">
                Prefix
              </label>
              <input
                id="prefix"
                className="input font-mono uppercase"
                maxLength={12}
                placeholder="DIWALI"
                value={form.prefix}
                onChange={(event) => set('prefix', event.target.value.toUpperCase())}
              />
            </div>
            <div>
              <label className="label" htmlFor="code-length">
                Random length
              </label>
              <input
                id="code-length"
                className="input"
                type="number"
                min={6}
                max={32}
                required
                value={form.codeLength}
                onChange={(event) => set('codeLength', Number(event.target.value))}
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="label" htmlFor="charset">
              Charset
            </label>
            <input
              id="charset"
              className="input font-mono text-xs"
              value={form.charset}
              onChange={(event) => set('charset', event.target.value.toUpperCase())}
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Default excludes 0/O/1/I to avoid transcription mistakes. A checksum character is always
              appended so guessed codes are rejected before any database lookup.
            </p>
          </div>

          {strength ? (
            <div className="mt-4 rounded-xl bg-slate-50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`badge ${RATING_STYLES[strength.rating]}`}>
                  {strength.rating.replace('-', ' ')}
                </span>
                <span className="text-xs text-slate-500">
                  {strength.entropyBits} bits · {formatCompact(strength.combinations)} combinations
                </span>
              </div>
              <p className="mt-2 break-all font-mono text-xs text-slate-600">
                e.g. {strength.samples.slice(0, 3).join('  ')}
              </p>
              <p className="mt-1 break-all text-xs text-slate-400">{strength.exampleUrl}</p>
            </div>
          ) : null}

          <div className="mt-4">
            <label className="label" htmlFor="expires">
              Campaign end date <span className="text-slate-400">(optional)</span>
            </label>
            <input
              id="expires"
              className="input"
              type="date"
              value={form.expiresAt}
              onChange={(event) => set('expiresAt', event.target.value)}
            />
          </div>
        </fieldset>

        {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner /> : null}
            {queued ? 'Queue' : 'Generate'} {Number(form.quantity).toLocaleString()} codes
          </button>
        </div>
      </form>
    </Modal>
  );
}
