import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toApiError } from '../../lib/api';
import { EventDelivery, EventDeliveryPage } from '../../lib/types';
import { formatDate, formatNumber } from '../../lib/format';
import { EmptyState, Modal, PageHeader, StatCard } from '../../components/admin/ui';
import { FullPageLoader, Spinner } from '../../components/Spinner';
import { useAuth } from '../../lib/auth';
import { PERMISSIONS } from '../../lib/permissions';

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  DELIVERING: 'bg-sky-50 text-sky-700',
  DELIVERED: 'bg-emerald-50 text-emerald-700',
  FAILED: 'bg-rose-50 text-rose-700',
};

export default function EventsPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [inspecting, setInspecting] = useState<string | null>(null);

  const canManage = can(PERMISSIONS.EVENTS_MANAGE);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'events', { status, page }],
    queryFn: async () =>
      (
        await api.get<EventDeliveryPage>('/admin/events', {
          params: { status: status || undefined, page, pageSize: 20 },
        })
      ).data,
    refetchInterval: 15_000,
  });

  const retry = useMutation({
    mutationFn: async (id: string) => (await api.post(`/admin/events/${id}/retry`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'events'] }),
  });

  if (isLoading || !data) return <FullPageLoader />;

  return (
    <>
      <PageHeader
        title="Event deliveries"
        subtitle="Every survey response queued for a webhook or RudderStack. Nothing is dropped — failed events stay here until they are delivered."
      />

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <StatCard label="Queued" value={formatNumber(data.counts.pending)} />
        <StatCard label="Delivered" value={formatNumber(data.counts.delivered)} tone="good" />
        <StatCard
          label="Failed"
          value={formatNumber(data.counts.failed)}
          tone={data.counts.failed > 0 ? 'bad' : 'default'}
        />
      </div>

      <div className="mb-4 mt-6 flex flex-col gap-2 sm:flex-row">
        <select
          className="input sm:max-w-[200px]"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {['PENDING', 'DELIVERING', 'DELIVERED', 'FAILED'].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      {data.items.length === 0 ? (
        <EmptyState
          title="No events yet"
          message="Turn on forwarding for a survey to start streaming responses to your own systems."
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Destination</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Attempts</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((item) => (
                <tr key={item.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{item.eventName}</p>
                    <p className="text-xs text-slate-400">{item.target}</p>
                  </td>
                  <td className="hidden max-w-[260px] truncate px-4 py-3 text-xs text-slate-500 sm:table-cell">
                    {item.endpoint}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${STATUS_STYLES[item.status] ?? 'bg-slate-100 text-slate-600'}`}>
                      {item.status}
                    </span>
                    {item.lastError ? (
                      <p className="mt-1 max-w-[220px] truncate text-xs text-rose-600" title={item.lastError}>
                        {item.lastError}
                      </p>
                    ) : null}
                  </td>
                  <td className="hidden px-4 py-3 tabular-nums text-slate-600 sm:table-cell">
                    {item.attempts}/{item.maxAttempts}
                    {item.status === 'PENDING' && item.attempts > 0 ? (
                      <p className="text-xs text-slate-400">retry {formatDate(item.nextAttemptAt)}</p>
                    ) : null}
                  </td>
                  <td className="hidden px-4 py-3 text-slate-500 lg:table-cell">
                    {formatDate(item.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="btn-ghost px-2 text-xs"
                      onClick={() => setInspecting(item.id)}
                    >
                      View
                    </button>
                    {canManage && item.status !== 'DELIVERED' ? (
                      <button
                        type="button"
                        className="btn-ghost px-2 text-xs"
                        disabled={retry.isPending}
                        onClick={() => retry.mutate(item.id)}
                      >
                        Retry
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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

      {inspecting ? <PayloadModal id={inspecting} onClose={() => setInspecting(null)} /> : null}
    </>
  );
}

function PayloadModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'events', id],
    queryFn: async () => (await api.get<EventDelivery>(`/admin/events/${id}`)).data,
  });

  return (
    <Modal open title="Event payload" onClose={onClose} size="lg">
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{toApiError(error).message}</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-500">
            Payloads never contain an e-mail address. Consumers are identified by a one-way hash.
          </p>
          <pre className="max-h-[60vh] overflow-auto rounded-2xl bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
            {JSON.stringify(data?.payload ?? {}, null, 2)}
          </pre>
        </>
      )}
    </Modal>
  );
}
