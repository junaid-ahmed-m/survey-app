import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Batch, Paginated } from '../../lib/types';
import { formatDate, statusClass, SURVEY_TYPE_LABELS } from '../../lib/format';
import { EmptyState, GenerationProgress, PageHeader } from '../../components/admin/ui';
import { CreateBatchModal } from '../../components/admin/CreateBatchModal';
import { FullPageLoader } from '../../components/Spinner';
import { useAuth } from '../../lib/auth';
import { PERMISSIONS } from '../../lib/permissions';

export default function BatchesPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);

  const canManage = can(PERMISSIONS.BATCHES_MANAGE);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'batches', { search, status, page }],
    queryFn: async () =>
      (
        await api.get<Paginated<Batch>>('/admin/batches', {
          params: { search: search || undefined, status: status || undefined, page, pageSize: 20 },
        })
      ).data,
    // Keep polling while the worker is still producing codes for a batch.
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (batch) => batch.generation.status === 'PENDING' || batch.generation.status === 'RUNNING',
      )
        ? 5_000
        : false,
  });

  return (
    <>
      <PageHeader
        title="Batches & QR codes"
        subtitle="Every batch defines the survey and the reward for the codes it contains."
        actions={
          canManage ? (
            <button type="button" className="btn-primary" onClick={() => setModalOpen(true)}>
              + New batch
            </button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input
          className="input sm:max-w-xs"
          placeholder="Search by name or SKU…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <select
          className="input sm:max-w-[180px]"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {['ACTIVE', 'PAUSED', 'ARCHIVED', 'DRAFT'].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <FullPageLoader />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No batches yet"
          message="Create a batch to generate codes and QR codes for your campaign."
          action={
            canManage ? (
              <button type="button" className="btn-primary" onClick={() => setModalOpen(true)}>
                Create the first batch
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Cards on mobile */}
          <div className="grid gap-3 lg:hidden">
            {data.items.map((batch) => (
              <Link key={batch.id} to={`/admin/batches/${batch.id}`} className="card block p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{batch.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {SURVEY_TYPE_LABELS[batch.surveyType]} · {batch.couponType}
                      {batch.sku ? ` · ${batch.sku}` : ''}
                    </p>
                  </div>
                  <span className={`badge ${statusClass(batch.status)}`}>{batch.status}</span>
                </div>
                <div className="mt-3 flex gap-4 text-xs text-slate-500">
                  <span>{batch.stats.total} codes</span>
                  <span>{batch.stats.used} used</span>
                  <span>{batch.stats.unused} unused</span>
                </div>
                {batch.generation.status !== 'COMPLETE' ? (
                  <div className="mt-3">
                    <GenerationProgress generation={batch.generation} compact />
                  </div>
                ) : null}
              </Link>
            ))}
          </div>

          {/* Table on desktop */}
          <div className="card hidden overflow-hidden lg:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Batch</th>
                  <th className="px-4 py-3 font-medium">SKU</th>
                  <th className="px-4 py-3 font-medium">Survey</th>
                  <th className="px-4 py-3 font-medium">Coupon</th>
                  <th className="px-4 py-3 font-medium">Codes</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((batch) => (
                  <tr key={batch.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link to={`/admin/batches/${batch.id}`} className="font-medium text-brand-700">
                        {batch.name}
                      </Link>
                      {batch.prefix ? (
                        <span className="ml-2 font-mono text-xs text-slate-400">{batch.prefix}…</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{batch.sku ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{SURVEY_TYPE_LABELS[batch.surveyType]}</td>
                    <td className="px-4 py-3 text-slate-600">{batch.couponType}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">
                      {batch.generation.status === 'COMPLETE' ? (
                        `${batch.stats.used}/${batch.stats.total}`
                      ) : (
                        <div className="w-40">
                          <GenerationProgress generation={batch.generation} compact />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${statusClass(batch.status)}`}>{batch.status}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(batch.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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

      <CreateBatchModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
