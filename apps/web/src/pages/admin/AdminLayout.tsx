import { useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { FullPageLoader } from '../../components/Spinner';

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: '▤', end: true },
  { to: '/admin/batches', label: 'Batches & QR', icon: '▦' },
  { to: '/admin/coupons', label: 'Coupons', icon: '🎟' },
  { to: '/admin/surveys', label: 'Surveys', icon: '✎' },
  { to: '/admin/responses', label: 'Responses', icon: '☷' },
];

export default function AdminLayout() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  if (loading) return <FullPageLoader label="Loading admin portal…" />;
  if (!user) return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;

  return (
    <div className="min-h-dvh bg-slate-50 lg:flex">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">
            QR
          </div>
          <span className="text-sm font-semibold text-slate-800">Admin</span>
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
        <div className="hidden items-center gap-2 px-5 py-5 lg:flex">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-sm font-bold text-white">
            QR
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">Scan &amp; Reward</p>
            <p className="text-xs text-slate-400">Admin portal</p>
          </div>
        </div>

        <nav className="space-y-1 px-3 py-4 lg:py-0">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'
                }`
              }
            >
              <span className="w-5 text-center text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="absolute inset-x-0 bottom-0 border-t border-slate-100 p-3">
          <div className="rounded-xl bg-slate-50 px-3 py-2.5">
            <p className="truncate text-sm font-medium text-slate-700">{user.name ?? user.email}</p>
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
