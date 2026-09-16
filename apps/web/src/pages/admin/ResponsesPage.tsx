import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Batch, Paginated, SurveyResponseRow } from '../../lib/types';
import { formatDate, SURVEY_TYPE_LABELS } from '../../lib/format';
import { EmptyState, Modal, PageHeader } from '../../components/admin/ui';
import { FullPageLoader } from '../../components/Spinner';

export default function ResponsesPage() {
  const [batchId, setBatchId] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<SurveyResponseRow | null>(null);

  const { data: batches } = useQuery({
    queryKey: ['admin', 'batches', 'all'],
    queryFn: async () =>
      (await api.get<Paginated<Batch>>('/admin/batches', { params: { pageSize: 100 } })).data,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'responses', { batchId, page }],
    queryFn: async () =>
      (
        await api.get<Paginated<SurveyResponseRow>>('/admin/responses', {
          params: { batchId: batchId || undefined, page, pageSize: 25 },
        })
      ).data,
  });

  if (isLoading) return <FullPageLoader />;

  return (
    <>
      <PageHeader title="Responses" subtitle="Completed surveys and the e-mail the reward was sent to." />

      <div className="mb-4">
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
                      <td className="px-4 py-3 text-slate-600">{row.email ?? '—'}</td>
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
