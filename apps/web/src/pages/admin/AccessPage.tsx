import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toApiError } from '../../lib/api';
import { AdminUserRow, Role } from '../../lib/types';
import { formatDate } from '../../lib/format';
import { Modal, PageHeader } from '../../components/admin/ui';
import { FullPageLoader, Spinner } from '../../components/Spinner';
import { useAuth } from '../../lib/auth';
import { PERMISSIONS, PermissionGroup } from '../../lib/permissions';

export default function AccessPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [roleModal, setRoleModal] = useState<Role | 'new' | null>(null);
  const [userModal, setUserModal] = useState<AdminUserRow | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManageRoles = can(PERMISSIONS.ROLES_MANAGE);
  const canViewUsers = can(PERMISSIONS.USERS_VIEW);
  const canManageUsers = can(PERMISSIONS.USERS_MANAGE);

  const { data: catalog } = useQuery({
    queryKey: ['admin', 'permission-catalog'],
    queryFn: async () =>
      (await api.get<{ groups: PermissionGroup[]; all: string[] }>('/admin/roles/permissions')).data
        .groups,
  });

  const { data: roles, isLoading } = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: async () => (await api.get<Role[]>('/admin/roles')).data,
  });

  const { data: users } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => (await api.get<AdminUserRow[]>('/admin/users')).data,
    enabled: canViewUsers,
  });

  const deleteRole = useMutation({
    mutationFn: async (name: string) => api.delete(`/admin/roles/${name}`),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
    },
    onError: (err) => setError(toApiError(err).message),
  });

  if (isLoading) return <FullPageLoader />;

  return (
    <>
      <PageHeader
        title="Access"
        subtitle="Roles decide who can see e-mails, coupon codes and QR codes, and who may import or export them."
        actions={
          canManageRoles ? (
            <button type="button" className="btn-primary" onClick={() => setRoleModal('new')}>
              + New role
            </button>
          ) : null
        }
      />

      {error ? (
        <p className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Permissions</th>
                <th className="px-4 py-3 font-medium">Users</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {roles?.map((role) => (
                <tr key={role.name} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{role.name}</p>
                    {role.description ? (
                      <p className="text-xs text-slate-400">{role.description}</p>
                    ) : null}
                    {role.isSystem ? (
                      <span className="badge mt-1 bg-slate-100 text-slate-500">System</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{role.permissions.length}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{role.userCount}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="btn-ghost px-2 py-1"
                      onClick={() => setRoleModal(role)}
                    >
                      {canManageRoles && role.name !== 'SUPER_ADMIN' ? 'Edit' : 'View'}
                    </button>
                    {canManageRoles && !role.isSystem && role.userCount === 0 ? (
                      <button
                        type="button"
                        className="btn-ghost px-2 py-1 text-rose-600"
                        onClick={() => deleteRole.mutate(role.name)}
                      >
                        Delete
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {canViewUsers ? (
        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Admin users</h2>
            {canManageUsers ? (
              <button type="button" className="btn-secondary" onClick={() => setUserModal('new')}>
                + Invite user
              </button>
            ) : null}
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">E-mail</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Last login</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users?.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700">{row.email ?? row.maskedEmail ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{row.name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{row.role}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`badge ${
                            row.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {row.isActive ? 'Active' : 'Disabled'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {row.lastLoginAt ? formatDate(row.lastLoginAt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canManageUsers ? (
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1"
                            onClick={() => setUserModal(row)}
                          >
                            Edit
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {roleModal ? (
        <RoleEditor
          role={roleModal === 'new' ? null : roleModal}
          catalog={catalog ?? []}
          readOnly={!canManageRoles || (roleModal !== 'new' && roleModal.name === 'SUPER_ADMIN')}
          onClose={() => setRoleModal(null)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
            setRoleModal(null);
          }}
        />
      ) : null}

      {userModal ? (
        <UserEditor
          user={userModal === 'new' ? null : userModal}
          roles={roles ?? []}
          onClose={() => setUserModal(null)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
            void queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
            setUserModal(null);
          }}
        />
      ) : null}
    </>
  );
}

function RoleEditor({
  role,
  catalog,
  readOnly,
  onClose,
  onSaved,
}: {
  role: Role | null;
  catalog: PermissionGroup[];
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [permissions, setPermissions] = useState<string[]>(role?.permissions ?? []);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => new Set(permissions), [permissions]);

  const toggle = (key: string) =>
    setPermissions((current) =>
      current.includes(key) ? current.filter((value) => value !== key) : [...current, key],
    );

  const mutation = useMutation({
    mutationFn: async () => {
      const body = { description: description || undefined, permissions };
      if (role) return api.patch(`/admin/roles/${role.name}`, body);
      return api.post('/admin/roles', { name, ...body });
    },
    onSuccess: onSaved,
    onError: (err) => setError(toApiError(err).message),
  });

  return (
    <Modal open title={role ? `Role · ${role.name}` : 'New role'} onClose={onClose} size="lg">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          mutation.mutate();
        }}
      >
        {role ? null : (
          <div>
            <label className="label" htmlFor="role-name">
              Name
            </label>
            <input
              id="role-name"
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value.toUpperCase())}
              placeholder="SUPPORT_AGENT"
              required
            />
            <p className="mt-1 text-xs text-slate-400">
              Upper-case letters, digits and underscores, 3–32 characters.
            </p>
          </div>
        )}

        <div>
          <label className="label" htmlFor="role-description">
            Description
          </label>
          <input
            id="role-description"
            className="input"
            value={description ?? ''}
            onChange={(event) => setDescription(event.target.value)}
            disabled={readOnly}
          />
        </div>

        <div className="space-y-4">
          {catalog.map((group) => (
            <fieldset key={group.group} className="rounded-xl border border-slate-200 p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {group.group}
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.items.map((item) => (
                  <label key={item.key} className="flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.has(item.key)}
                      disabled={readOnly}
                      onChange={() => toggle(item.key)}
                    />
                    <span>
                      {item.label}
                      {item.sensitive ? (
                        <span className="badge ml-1 bg-amber-50 text-amber-700">sensitive</span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
          {readOnly ? null : (
            <button type="submit" className="btn-primary" disabled={mutation.isPending}>
              {mutation.isPending ? <Spinner /> : null}
              Save role
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

function UserEditor({
  user,
  roles,
  onClose,
  onSaved,
}: {
  user: AdminUserRow | null;
  roles: Role[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState(user?.email ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(user?.role ?? roles[0]?.name ?? '');
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (user) {
        return api.patch(`/admin/users/${user.id}`, {
          name: name || undefined,
          role,
          isActive,
          password: password || undefined,
        });
      }
      return api.post('/admin/users', { email, name: name || undefined, password, role });
    },
    onSuccess: onSaved,
    onError: (err) => setError(toApiError(err).message),
  });

  return (
    <Modal
      open
      title={user ? `User · ${user.maskedEmail ?? user.email}` : 'Invite admin user'}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          mutation.mutate();
        }}
      >
        {user ? null : (
          <div>
            <label className="label" htmlFor="user-email">
              E-mail
            </label>
            <input
              id="user-email"
              type="email"
              className="input"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
        )}

        <div>
          <label className="label" htmlFor="user-name">
            Name
          </label>
          <input
            id="user-name"
            className="input"
            value={name ?? ''}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="user-password">
            {user ? 'New password (optional)' : 'Temporary password'}
          </label>
          <input
            id="user-password"
            type="password"
            className="input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required={!user}
            minLength={8}
          />
        </div>

        <div>
          <label className="label" htmlFor="user-role">
            Role
          </label>
          <select
            id="user-role"
            className="input"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            {roles.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </div>

        {user ? (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            Active
          </label>
        ) : null}

        {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner /> : null}
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
