import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch } from '../lib/api.js';

export interface OwnerUser {
  userId: number;
  owner: boolean;
}

interface AuthContextValue {
  /** null while the session is loading or when unauthenticated. */
  user: OwnerUser | null;
  loading: boolean;
  logout: () => Promise<void>;
  /** Re-check the session (used after login/setup succeeds). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<OwnerUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const me = await apiFetch<{ authenticated: boolean; owner: boolean; userId: number }>(
        '/api/me',
      );
      setUser({ userId: me.userId, owner: me.owner });
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiFetch('/api/logout', { method: 'POST' });
    } catch {
      // session already gone — treat as logged out
    }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
