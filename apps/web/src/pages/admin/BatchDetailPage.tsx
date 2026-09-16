import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeCanvas } from 'qrcode.react';
import { api, toApiError } from '../../lib/api';
import { Batch, BatchCode, Paginated } from '../../lib/types';
import { formatDate, statusClass, SURVEY_TYPE_LABELS } from '../../lib/format';
import { Modal, PageHeader, StatCard } from '../../components/admin/ui';
import { FullPageLoader, Spinner } from '../../components/Spinner';

export default function BatchDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [qrCode, setQrCode] = useState<BatchCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);

  const { data: batch, isLoading } = useQuery({
    queryKey: ['admin', 'batch', id],
    queryFn: async () => (await api.get<Batch>(`/admin/batches/${id}`)).data,
  });

  const { data: codes } = useQuery({
    queryKey: ['admin', 'batch-codes', id, { page, status }],
    queryFn: async () =>
      (
        await api.get<Paginated<BatchCode>>(`/admin/batches/${id}/codes`, {
          params: { page, pageSize: 25, status: status || undefined },
        })
      ).data,
  });

  const statusMutation = useMutation({
    mutationFn: async (next: string) =>
      (await api.patch<Batch>(`/admin/batches/${id}/status`, { status: next })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'batch', id] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'batches'] });
    },
    onError: (err) => setError(toApiError(err).message),
  });

  const downloadCsv = async () => {
    setExporting(true);
    setError(null);
    try {
      const response = await api.get(`/admin/batches/${id}/export.csv`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${batch?.name.replace(/[^\w-]+/g, '-') ?? 'batch'}-codes.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setExporting(false);
    }
  };

  const downloadQrPng = () => {
    const canvas = qrRef.current?.querySelector('canvas');
    if (!canvas || !qrCode) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `${qrCode.code}.png`;
    link.click();
  };

  if (isLoading || !batch) return <FullPageLoader />;

  const totalPages = codes ? Math.max(Math.ceil(codes.total / codes.pageSize), 1) : 1;

  return (
    <>
      <Link to="/admin/batches" className="mb-3 inline-block text-sm text-brand-700">
        ← Back to batches
      </Link>

      <PageHeader
        title={batch.name}
        subtitle={batch.description ?? undefined}
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={downloadCsv} disabled={exporting}>
              {exporting ? <Spinner /> : null}
              Export CSV
            </button>
            {batch.status === 'ACTIVE' ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => statusMutation.mutate('PAUSED')}
              >
                Pause
              </button>
            ) : batch.status !== 'ARCHIVED' ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => statusMutation.mutate('ACTIVE')}
              >
                Activate
              </button>
            ) : null}
          </>
        }
      />

      {error ? (
        <p className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Total codes" value={batch.stats.total} />
        <StatCard label="Used" value={batch.stats.used} tone="good" />
        <StatCard label="In progress" value={batch.stats.reserved} tone="warn" />
        <StatCard
          label="Coupons in stock"
          value={batch.couponsAvailable ?? 0}
          tone={(batch.couponsAvailable ?? 0) === 0 ? 'bad' : 'default'}
        />
      </div>

      <div className="card mt-4 p-5">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Status', value: <span className={`badge ${statusClass(batch.status)}`}>{batch.status}</span> },
            { label: 'Survey type', value: SURVEY_TYPE_LABELS[batch.surveyType] },
            {
              label: 'Survey reference',
              value: batch.surveyLabel ?? batch.surveyUrl ?? batch.surveyId ?? '—',
            },
            { label: 'Coupon type', value: batch.couponType },
            { label: 'Prefix', value: batch.prefix || '—' },
            { label: 'Code length', value: `${batch.codeLength} + checksum` },
            { label: 'Charset', value: <span className="font-mono text-xs">{batch.charset}</span> },
            { label: 'Campaign ends', value: batch.expiresAt ? formatDate(batch.expiresAt) : '—' },
          ].map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className="text-xs uppercase tracking-wide text-slate-400">{item.label}</dt>
              <dd className="mt-1 truncate text-sm text-slate-800">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Codes</h2>
        <select
          className="input sm:max-w-[180px]"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {['UNUSED', 'RESERVED', 'USED', 'DISABLED'].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      <div className="card mt-3 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Scans</th>
                <th className="px-4 py-3 font-medium">Used at</th>
                <th className="px-4 py-3 font-medium text-right">QR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {codes?.items.map((code) => (
                <tr key={code.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-slate-800">{code.code}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${statusClass(code.status)}`}>{code.status}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{code.scanCount}</td>
                  <td className="px-4 py-3 text-slate-500">{code.usedAt ? formatDate(code.usedAt) : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" className="btn-ghost px-2 py-1" onClick={() => setQrCode(code)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {codes && codes.total > codes.pageSize ? (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {codes.page} of {totalPages}
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
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      <Modal open={Boolean(qrCode)} title="QR code" onClose={() => setQrCode(null)}>
        {qrCode ? (
          <div className="text-center">
            <div ref={qrRef} className="inline-block rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <QRCodeCanvas value={qrCode.url} size={224} level="M" includeMargin />
            </div>
            <p className="mt-4 break-all font-mono text-sm font-semibold text-slate-800">{qrCode.code}</p>
            <p className="mt-1 break-all text-xs text-slate-400">{qrCode.url}</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button type="button" className="btn-secondary" onClick={() => navigator.clipboard.writeText(qrCode.url)}>
                Copy link
              </button>
              <button type="button" className="btn-primary" onClick={downloadQrPng}>
                Download PNG
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
