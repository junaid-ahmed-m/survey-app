import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, TOKEN_STORAGE_KEY, toApiError } from './api';
import { Permission } from './permissions';

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  permissions: Permission[];
}

interface AuthContextValue {
  user: AdminUser | null;
  loading: boolean;
  /** True when the signed-in user holds every listed permission. */
  can: (...permissions: Permission[]) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get<AdminUser>('/admin/auth/me')
      .then(({ data }) => setUser(data))
      .catch(() => localStorage.removeItem(TOKEN_STORAGE_KEY))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const { data } = await api.post<{ accessToken: string; user: AdminUser }>('/admin/auth/login', {
        email,
        password,
      });
      localStorage.setItem(TOKEN_STORAGE_KEY, data.accessToken);
      setUser(data.user);
    } catch (error) {
      throw toApiError(error);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setUser(null);
  }, []);

  const can = useCallback(
    (...permissions: Permission[]) =>
      permissions.every((permission) => user?.permissions?.includes(permission) ?? false),
    [user],
  );

  const value = useMemo(
    () => ({ user, loading, can, login, logout }),
    [user, loading, can, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
