import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { DashboardStats } from '../../lib/types';
import { formatDate, formatNumber } from '../../lib/format';
import { PageHeader, StatCard } from '../../components/admin/ui';
import { FullPageLoader } from '../../components/Spinner';

const ACTION_LABELS: Record<string, string> = {
  REDEEM_STARTED: 'Survey started',
  REDEEM_COMPLETED: 'Reward issued',
  REDEEM_COUPONS_EXHAUSTED: 'Blocked — no coupons left',
  REDEEM_UNKNOWN_CODE: 'Unknown code scanned',
  REDEEM_INVALID_CHECKSUM: 'Malformed code rejected',
};

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: async () => (await api.get<DashboardStats>('/admin/stats')).data,
    refetchInterval: 30_000,
  });

  if (isLoading || !data) return <FullPageLoader />;

  const alerts = data.couponAlerts ?? [];
  const empty = alerts.filter((alert) => alert.severity === 'EMPTY');
  const lowStock = alerts.length > 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Live view of codes, coupon inventory and redemptions."
        actions={
          <Link to="/admin/batches" className="btn-primary">
            Generate codes
          </Link>
        }
      />

      {alerts.length > 0 ? (
        <div
          className={`mb-6 rounded-2xl border px-4 py-3 text-sm ${
            empty.length > 0
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          <strong className="font-semibold">
            {empty.length > 0
              ? `${empty.length} coupon type${empty.length === 1 ? ' is' : 's are'} out of stock.`
              : `${alerts.length} coupon type${alerts.length === 1 ? '' : 's'} running low.`}
          </strong>{' '}
          While a pool is empty, codes are not consumed and shoppers are asked to try again later.
          <ul className="mt-2 space-y-1">
            {alerts.map((alert) => (
              <li key={alert.couponTypeCode} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-xs font-semibold">{alert.couponTypeCode}</span>
                <span className="text-xs">
                  {alert.name} — {formatNumber(alert.available)} left of {formatNumber(alert.threshold)}{' '}
                  threshold
                  {alert.reserved > 0 ? `, ${formatNumber(alert.reserved)} on hold` : ''}
                  {alert.activeBatches > 0
                    ? `, ${alert.activeBatches} active batch${alert.activeBatches === 1 ? '' : 'es'}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
          <Link to="/admin/coupons" className="mt-2 inline-block font-medium underline">
            Top up inventory
          </Link>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Codes issued" value={formatNumber(data.codes.total)} hint={`${data.batches} batches`} />
        <StatCard
          label="Redeemed"
          value={formatNumber(data.codes.used)}
          hint={`${data.codes.redemptionRate}% redemption rate`}
          tone="good"
        />
        <StatCard label="Unused" value={formatNumber(data.codes.unused)} />
        <StatCard
          label="Coupons left"
          value={formatNumber(data.coupons.available)}
          tone={lowStock ? 'bad' : 'default'}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">Coupon inventory</h2>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Available', value: data.coupons.available },
              { label: 'Reserved', value: data.coupons.reserved },
              { label: 'Issued', value: data.coupons.issued },
              { label: 'Expired', value: data.coupons.expired },
            ].map((item) => (
              <div key={item.label} className="rounded-xl bg-slate-50 px-3 py-3">
                <dt className="text-xs text-slate-500">{item.label}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                  {formatNumber(item.value)}
                </dd>
              </div>
            ))}
          </dl>

          <h2 className="mt-7 text-sm font-semibold text-slate-900">Code status</h2>
          <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
            {[
              { value: data.codes.used, className: 'bg-brand-600' },
              { value: data.codes.unused, className: 'bg-slate-300' },
            ].map((segment, index) => (
              <div
                key={index}
                className={segment.className}
                style={{ width: `${data.codes.total ? (segment.value / data.codes.total) * 100 : 0}%` }}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-brand-600" />
              Used {formatNumber(data.codes.used)}
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-300" />
              Unused {formatNumber(data.codes.unused)}
            </span>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-900">Recent activity</h2>
          <ul className="mt-4 space-y-3">
            {data.recentActivity.length === 0 ? (
              <li className="text-sm text-slate-400">No activity yet.</li>
            ) : (
              data.recentActivity.map((item) => (
                <li key={item.id} className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-700">
                      {ACTION_LABELS[item.action] ?? item.action}
                    </p>
                    <p className="text-xs text-slate-400">{formatDate(item.createdAt)}</p>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </>
  );
}
