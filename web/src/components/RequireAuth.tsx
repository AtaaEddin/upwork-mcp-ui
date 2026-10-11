import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../context/auth.js';

/** Route guard: waits for the session check, then allows or bounces to /login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center" role="status" aria-label="Loading">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-up-green border-t-transparent" />
      </div>
    );
  }
  if (user === null) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
