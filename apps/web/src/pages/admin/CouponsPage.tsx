import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toApiError } from '../../lib/api';
import { CouponRow, CouponType, Paginated } from '../../lib/types';
import { formatDate, statusClass } from '../../lib/format';
import { EmptyState, Modal, PageHeader } from '../../components/admin/ui';
import { FullPageLoader, Spinner } from '../../components/Spinner';
import { useAuth } from '../../lib/auth';
import { PERMISSIONS } from '../../lib/permissions';

export default function CouponsPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [typeModal, setTypeModal] = useState(false);
  const [importModal, setImportModal] = useState<string | null>(null);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage] = useState(1);
  const [revealEmails, setRevealEmails] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  const canManage = can(PERMISSIONS.COUPONS_MANAGE);
  const canImport = can(PERMISSIONS.COUPONS_IMPORT);
  const canReveal = can(PERMISSIONS.COUPONS_REVEAL);
  const canRevealEmails = can(PERMISSIONS.EMAILS_REVEAL);

  const { data: types, isLoading } = useQuery({
    queryKey: ['admin', 'coupon-types'],
    queryFn: async () => (await api.get<CouponType[]>('/admin/coupons/types')).data,
  });

  const { data: coupons } = useQuery({
    queryKey: ['admin', 'coupons', { filterType, filterStatus, page, revealEmails }],
    queryFn: async () =>
      (
        await api.get<Paginated<CouponRow>>('/admin/coupons', {
          params: {
            couponTypeCode: filterType || undefined,
            status: filterStatus || undefined,
            page,
            pageSize: 25,
            reveal: revealEmails ? 'true' : undefined,
          },
        })
      ).data,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'coupon-types'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'coupons'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
  };

  /** One coupon at a time - the server audits every clear-text read. */
  const revealCoupon = async (couponId: string) => {
    setRevealing(couponId);
    setRevealError(null);
    try {
      const { data } = await api.get<{ couponCode: string }>(`/admin/coupons/${couponId}/reveal`);
      setRevealed((current) => ({ ...current, [couponId]: data.couponCode }));
    } catch (err) {
      setRevealError(toApiError(err).message);
    } finally {
      setRevealing(null);
    }
  };

  if (isLoading) return <FullPageLoader />;

  return (
    <>
      <PageHeader
        title="Coupons"
        subtitle="Coupon types and their inventory. A coupon is held for a minute while the survey starts."
        actions={
          canManage ? (
            <button type="button" className="btn-primary" onClick={() => setTypeModal(true)}>
              + New coupon type
            </button>
          ) : null
        }
      />

      {!types || types.length === 0 ? (
        <EmptyState
          title="No coupon types"
          message="Create a coupon type, then import or generate its inventory."
          action={
            canManage ? (
              <button type="button" className="btn-primary" onClick={() => setTypeModal(true)}>
                Create coupon type
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {types.map((type) => {
            const empty = type.inventory.available === 0;
            const low = !empty && type.inventory.available <= type.lowStockThreshold;
            return (
              <div key={type.code} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{type.name}</p>
                    <p className="font-mono text-xs text-slate-400">{type.code}</p>
                  </div>
                  {type.value ? <span className="badge bg-brand-50 text-brand-700">{type.value}</span> : null}
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  {[
                    {
                      label: 'Available',
                      value: type.inventory.available,
                      tone: empty ? 'text-rose-600' : low ? 'text-amber-600' : 'text-emerald-600',
                    },
                    { label: 'Reserved', value: type.inventory.reserved, tone: 'text-amber-600' },
                    { label: 'Issued', value: type.inventory.issued, tone: 'text-slate-700' },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl bg-slate-50 px-2 py-2">
                      <p className={`text-lg font-semibold tabular-nums ${item.tone}`}>{item.value}</p>
                      <p className="text-[11px] text-slate-500">{item.label}</p>
                    </div>
                  ))}
                </div>

                {empty ? (
                  <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    Out of stock — codes for this type will not be consumed.
                  </p>
                ) : low ? (
                  <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    Running low — at or below the alert threshold of {type.lowStockThreshold}.
                  </p>
                ) : null}

                {canImport ? (
                  <button
                    type="button"
                    className="btn-secondary mt-4 w-full"
                    onClick={() => setImportModal(type.code)}
                  >
                    Add inventory
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-8">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Inventory</h2>
          <div className="flex flex-wrap items-center gap-3">
            {canRevealEmails ? (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={revealEmails}
                  onChange={(event) => setRevealEmails(event.target.checked)}
                />
                Show e-mails
              </label>
            ) : null}
            <select
              className="input sm:max-w-[180px]"
              value={filterType}
              onChange={(event) => {
                setFilterType(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All types</option>
              {types?.map((type) => (
                <option key={type.code} value={type.code}>
                  {type.code}
                </option>
              ))}
            </select>
            <select
              className="input sm:max-w-[160px]"
              value={filterStatus}
              onChange={(event) => {
                setFilterStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {['AVAILABLE', 'RESERVED', 'ISSUED', 'EXPIRED'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>

        {revealError ? (
          <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{revealError}</p>
        ) : null}

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Coupon code</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Issued to</th>
                  <th className="px-4 py-3 font-medium">Issued at</th>
                  <th className="px-4 py-3 font-medium text-right">Code</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {coupons?.items.map((coupon) => (
                  <tr key={coupon.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-800">
                      {revealed[coupon.id] ?? coupon.maskedCouponCode}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{coupon.couponTypeCode}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${statusClass(coupon.status)}`}>{coupon.status}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {coupon.issuedToEmail ?? coupon.maskedIssuedToEmail ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {coupon.issuedAt ? formatDate(coupon.issuedAt) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canReveal ? (
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1"
                          disabled={revealing === coupon.id || Boolean(revealed[coupon.id])}
                          onClick={() => void revealCoupon(coupon.id)}
                        >
                          {revealing === coupon.id ? <Spinner /> : null}
                          {revealed[coupon.id] ? 'Revealed' : 'Reveal'}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">Hidden</span>
                      )}
                    </td>
                  </tr>
                ))}
                {coupons && coupons.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                      No coupons match these filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {coupons && coupons.total > coupons.pageSize ? (
          <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
            <span>
              Page {coupons.page} of {Math.ceil(coupons.total / coupons.pageSize)}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={page >= Math.ceil(coupons.total / coupons.pageSize)}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <CouponTypeModal open={typeModal} onClose={() => setTypeModal(false)} onSaved={refresh} />
      <ImportCouponsModal
        couponTypeCode={importModal}
        onClose={() => setImportModal(null)}
        onSaved={refresh}
      />
    </>
  );
}

function CouponTypeModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ code: '', name: '', value: '', description: '', lowStockThreshold: '10' });
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () =>
      (
        await api.post('/admin/coupons/types', {
          code: form.code.trim().toUpperCase(),
          name: form.name.trim(),
          value: form.value.trim() || undefined,
          description: form.description.trim() || undefined,
          lowStockThreshold: Number.parseInt(form.lowStockThreshold, 10) || 0,
        })
      ).data,
    onSuccess: () => {
      setForm({ code: '', name: '', value: '', description: '', lowStockThreshold: '10' });
      onSaved();
      onClose();
    },
    onError: (err) => setError(toApiError(err).message),
  });

  return (
    <Modal open={open} title="New coupon type" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          mutation.mutate();
        }}
      >
        <div>
          <label className="label" htmlFor="ct-code">
            Code
          </label>
          <input
            id="ct-code"
            className="input font-mono uppercase"
            required
            placeholder="AMAZON10"
            value={form.code}
            onChange={(event) => setForm((f) => ({ ...f, code: event.target.value.toUpperCase() }))}
          />
        </div>
        <div>
          <label className="label" htmlFor="ct-name">
            Display name
          </label>
          <input
            id="ct-name"
            className="input"
            required
            placeholder="Amazon ₹100 Gift Card"
            value={form.name}
            onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
          />
        </div>
        <div>
          <label className="label" htmlFor="ct-value">
            Value <span className="text-slate-400">(optional)</span>
          </label>
          <input
            id="ct-value"
            className="input"
            placeholder="₹100"
            value={form.value}
            onChange={(event) => setForm((f) => ({ ...f, value: event.target.value }))}
          />
        </div>
        <div>
          <label className="label" htmlFor="ct-description">
            Description <span className="text-slate-400">(optional)</span>
          </label>
          <input
            id="ct-description"
            className="input"
            value={form.description}
            onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
          />
        </div>
        <div>
          <label className="label" htmlFor="ct-threshold">
            Low stock alert at
          </label>
          <input
            id="ct-threshold"
            className="input"
            type="number"
            min={0}
            max={100000}
            value={form.lowStockThreshold}
            onChange={(event) => setForm((f) => ({ ...f, lowStockThreshold: event.target.value }))}
          />
          <p className="mt-1 text-xs text-slate-500">
            The dashboard raises an alert when available coupons drop to this number or below.
          </p>
        </div>

        {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner /> : null}
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ImportCouponsModal({
  couponTypeCode,
  onClose,
  onSaved,
}: {
  couponTypeCode: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<'generate' | 'paste'>('generate');
  const [count, setCount] = useState(100);
  const [pasted, setPasted] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = { couponTypeCode };
      if (expiresAt) payload.expiresAt = new Date(expiresAt).toISOString();
      if (mode === 'generate') {
        payload.generateCount = Number(count);
      } else {
        payload.codes = pasted
          .split(/[\s,;]+/)
          .map((value) => value.trim())
          .filter(Boolean);
      }
      return (
        await api.post<{ requested: number; imported: number; skippedDuplicates: number }>(
          '/admin/coupons/import',
          payload,
        )
      ).data;
    },
    onSuccess: (data) => {
      setResult(`${data.imported} coupons added (${data.skippedDuplicates} duplicates skipped).`);
      onSaved();
    },
    onError: (err) => setError(toApiError(err).message),
  });

  return (
    <Modal
      open={Boolean(couponTypeCode)}
      title={`Add inventory — ${couponTypeCode ?? ''}`}
      onClose={() => {
        setResult(null);
        setError(null);
        onClose();
      }}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          setResult(null);
          mutation.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: 'generate', label: 'Generate codes' },
              { value: 'paste', label: 'Paste partner codes' },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setMode(option.value)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                mode === option.value
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {mode === 'generate' ? (
          <div>
            <label className="label" htmlFor="coupon-count">
              How many coupons?
            </label>
            <input
              id="coupon-count"
              className="input"
              type="number"
              min={1}
              max={10000}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            />
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="coupon-codes">
              Coupon codes
            </label>
            <textarea
              id="coupon-codes"
              className="input min-h-[140px] font-mono text-xs"
              placeholder="ONE-PER-LINE"
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
            />
          </div>
        )}

        <div>
          <label className="label" htmlFor="coupon-expiry">
            Expiry date <span className="text-slate-400">(optional)</span>
          </label>
          <input
            id="coupon-expiry"
            className="input"
            type="date"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </div>

        {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {result ? (
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{result}</p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner /> : null}
            Add to inventory
          </button>
        </div>
      </form>
    </Modal>
  );
}
