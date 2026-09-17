import { ReactNode, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { FullPageLoader } from '../../components/Spinner';
import { BrandMark } from '../../components/BrandLogo';
import { EmptyState } from '../../components/admin/ui';
import { PERMISSIONS, Permission } from '../../lib/permissions';

const NAV: { to: string; label: string; icon: string; end?: boolean; permission: Permission }[] = [
  { to: '/admin', label: 'Dashboard', icon: '▤', end: true, permission: PERMISSIONS.DASHBOARD_VIEW },
  { to: '/admin/batches', label: 'Batches & QR', icon: '▦', permission: PERMISSIONS.BATCHES_VIEW },
  { to: '/admin/coupons', label: 'Coupons', icon: '🎟', permission: PERMISSIONS.COUPONS_VIEW },
  { to: '/admin/surveys', label: 'Surveys', icon: '✎', permission: PERMISSIONS.SURVEYS_VIEW },
  { to: '/admin/responses', label: 'Responses', icon: '☷', permission: PERMISSIONS.RESPONSES_VIEW },
  { to: '/admin/events', label: 'Deliveries', icon: '↻', permission: PERMISSIONS.EVENTS_VIEW },
  { to: '/admin/access', label: 'Access', icon: '🔒', permission: PERMISSIONS.ROLES_VIEW },
];

export default function AdminLayout() {
  const { user, loading, logout, can } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  if (loading) return <FullPageLoader label="Loading admin portal…" />;
  if (!user) return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;

  const nav = NAV.filter((item) => can(item.permission));

  return (
    <div className="min-h-dvh bg-brand-50/40 lg:flex">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-8" logoClassName="h-4 w-auto" />
          <span className="text-sm font-semibold text-ink-900">Admin</span>
        </div>
        <button
          type="button"
          className="btn-ghost px-3 py-2"
          aria-label="Toggle navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? '✕' : '☰'}
        </button>
      </header>

      {menuOpen ? (
        <div
          className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden"
          onClick={() => setMenuOpen(false)}
          aria-hidden
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 shrink-0 transform border-r border-slate-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="hidden items-center gap-2.5 px-5 py-5 lg:flex">
          <BrandMark className="h-10" logoClassName="h-5 w-auto" />
          <div>
            <p className="text-sm font-semibold text-ink-900">Scan &amp; Reward</p>
            <p className="text-xs text-slate-400">Admin portal</p>
          </div>
        </div>

        <nav className="space-y-1 px-3 py-4 lg:py-0">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-brand-50 font-semibold text-brand-700'
                    : 'text-ink-500 hover:bg-brand-50/60 hover:text-brand-700'
                }`
              }
            >
              <span className="w-5 text-center text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="absolute inset-x-0 bottom-0 border-t border-slate-100 p-3">
          <div className="rounded-xl bg-brand-50/70 px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-ink-900">{user.name ?? user.email}</p>
            <p className="truncate text-xs text-slate-400">{user.role}</p>
          </div>
          <button type="button" className="btn-ghost mt-2 w-full justify-start" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

/** Keeps deep links to a section the role cannot use out of the UI; the API enforces this too. */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { can } = useAuth();
  const nav = NAV.find((item) => can(item.permission));

  if (can(permission)) return <>{children}</>;
  if (nav) return <Navigate to={nav.to} replace />;

  return (
    <EmptyState
      title="No access"
      message="Your role does not have permission to view this section. Ask an administrator for access."
    />
  );
}
