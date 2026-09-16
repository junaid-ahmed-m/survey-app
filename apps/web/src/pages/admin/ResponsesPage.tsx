import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, toApiError } from '../../lib/api';
import { Batch, Paginated, SurveyResponseRow } from '../../lib/types';
import { formatDate, SURVEY_TYPE_LABELS } from '../../lib/format';
import { EmptyState, Modal, PageHeader } from '../../components/admin/ui';
import { FullPageLoader, Spinner } from '../../components/Spinner';
import { useAuth } from '../../lib/auth';
import { PERMISSIONS } from '../../lib/permissions';

export default function ResponsesPage() {
  const { can } = useAuth();
  const [batchId, setBatchId] = useState('');
  const [page, setPage] = useState(1);
  const [reveal, setReveal] = useState(false);
  const [selected, setSelected] = useState<SurveyResponseRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRevealEmails = can(PERMISSIONS.EMAILS_REVEAL);
  const canExport = can(PERMISSIONS.RESPONSES_EXPORT);

  const { data: batches } = useQuery({
    queryKey: ['admin', 'batches', 'all'],
    queryFn: async () =>
      (await api.get<Paginated<Batch>>('/admin/batches', { params: { pageSize: 100 } })).data,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'responses', { batchId, page, reveal }],
    queryFn: async () =>
      (
        await api.get<Paginated<SurveyResponseRow>>('/admin/responses', {
          params: {
            batchId: batchId || undefined,
            page,
            pageSize: 25,
            reveal: reveal ? 'true' : undefined,
          },
        })
      ).data,
  });

  if (isLoading) return <FullPageLoader />;

  const downloadCsv = async () => {
    setExporting(true);
    setError(null);
    try {
      const response = await api.get('/admin/responses/export.csv', {
        params: { batchId: batchId || undefined },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'survey-responses.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Responses"
        subtitle="Completed surveys and the e-mail the reward was sent to."
        actions={
          canExport ? (
            <button type="button" className="btn-secondary" onClick={downloadCsv} disabled={exporting}>
              {exporting ? <Spinner /> : null}
              Download CSV
            </button>
          ) : null
        }
      />

      {error ? (
        <p className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <select
          className="input sm:max-w-sm"
          value={batchId}
          onChange={(event) => {
            setBatchId(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All batches</option>
          {batches?.items.map((batch) => (
            <option key={batch.id} value={batch.id}>
              {batch.name}
            </option>
          ))}
        </select>
        {canRevealEmails ? (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={reveal} onChange={(event) => setReveal(event.target.checked)} />
            Show e-mails
          </label>
        ) : null}
      </div>

      {!data || data.items.length === 0 ? (
        <EmptyState title="No responses yet" message="Responses appear here as soon as users redeem codes." />
      ) : (
        <>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Completed</th>
                    <th className="px-4 py-3 font-medium">Batch</th>
                    <th className="px-4 py-3 font-medium">Survey</th>
                    <th className="px-4 py-3 font-medium">E-mail</th>
                    <th className="px-4 py-3 font-medium text-right">Answers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-600">{formatDate(row.completedAt)}</td>
                      <td className="px-4 py-3 text-slate-700">{row.batchName ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{SURVEY_TYPE_LABELS[row.surveyType]}</td>
                      <td className="px-4 py-3 text-slate-600">{row.email ?? row.maskedEmail ?? '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" className="btn-ghost px-2 py-1" onClick={() => setSelected(row)}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data.total > data.pageSize ? (
            <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
              <span>
                Page {data.page} of {Math.ceil(data.total / data.pageSize)}
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
                  disabled={page >= Math.ceil(data.total / data.pageSize)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <Modal open={Boolean(selected)} title="Survey answers" onClose={() => setSelected(null)}>
        {selected ? (
          <dl className="space-y-3">
            {Object.entries(selected.answers).map(([key, value]) => (
              <div key={key} className="rounded-xl bg-slate-50 px-3 py-2">
                <dt className="font-mono text-xs text-slate-400">{key}</dt>
                <dd className="mt-0.5 text-sm text-slate-800">
                  {Array.isArray(value) ? value.join(', ') : String(value)}
                </dd>
              </div>
            ))}
            {Object.keys(selected.answers).length === 0 ? (
              <p className="text-sm text-slate-400">No structured answers were captured for this response.</p>
            ) : null}
          </dl>
        ) : null}
      </Modal>
    </>
  );
}
