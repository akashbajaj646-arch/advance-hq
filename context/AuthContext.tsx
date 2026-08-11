'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { hasModuleAccess } from '@/lib/modules';

interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  permissions?: string[] | null; // null = all modules
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** True if the current user can access the given module key (see lib/modules.ts) */
  canAccess: (moduleKey: string) => boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  logout: async () => {},
  refresh: async () => {},
  canAccess: () => false,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    window.location.href = '/login';
  }, []);

  const canAccess = useCallback(
    (moduleKey: string) => hasModuleAccess(user, moduleKey),
    [user]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh, canAccess }}>
      {children}
    </AuthContext.Provider>
  );
}
