import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../context/auth.js';
import { ApiError, apiFetch } from '../lib/api.js';

type Mode = 'loading' | 'setup' | 'login' | 'signed-in';

const INPUT_CLASS =
  'w-full rounded-md border border-up-border bg-white px-3 py-2 text-sm text-up-black placeholder:text-up-black/40 focus:border-up-green focus:outline-none focus:ring-2 focus:ring-up-green/30 dark:border-white/20 dark:bg-transparent dark:text-white dark:placeholder:text-white/40';

function describeAuthError(err: unknown, mode: Mode): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'unauthorized':
        return 'Invalid password.';
      case 'rate_limited':
        return err.retryAfterSec !== undefined
          ? `Too many attempts — try again in ${Math.ceil(err.retryAfterSec)}s.`
          : 'Too many attempts — try again shortly.';
      case 'not_found':
        if (mode === 'setup') return 'Setup is already complete. Log in instead.';
        return 'Account not found. Restart the server or check OWNER_PASSWORD.';
      case 'bad_request':
        return err.message;
      default:
        if (err.status === 401) return 'Invalid password.';
        return err.message;
    }
  }
  return 'Something went wrong. Please try again.';
}

/**
 * Auth screen (plan 05): one Upwork-style card that branches on
 * `GET /api/setup` — first run asks to create the single owner password,
 * otherwise it is the login form (plan 02 endpoints).
 */
export function LoginPage() {
  const { user, loading: authLoading, refresh } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch<{ required: boolean }>('/api/setup');
        if (!cancelled) setMode(res.required ? 'setup' : 'login');
      } catch {
        if (!cancelled) setMode('login');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mode === 'signed-in') navigate('/', { replace: true });
  }, [mode, navigate]);

  if (!authLoading && user !== null) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (mode === 'setup') {
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
      if (password !== confirm) {
        setError('Passwords do not match.');
        return;
      }
    } else if (password.length === 0) {
      setError('Enter your password.');
      return;
    }

    setBusy(true);
    try {
      const path = mode === 'setup' ? '/api/setup' : '/api/login';
      await apiFetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      await refresh();
      setMode('signed-in');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'not_found' && mode === 'setup') {
        setMode('login');
      }
      setError(describeAuthError(err, mode));
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'loading') {
    return (
      <div className="flex min-h-full items-center justify-center bg-up-surface dark:bg-up-black">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-up-green border-t-transparent"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-up-surface px-4 py-10 dark:bg-up-black">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="text-3xl font-bold tracking-tight text-up-black dark:text-white">upwork</span>
          <span className="ml-2 rounded bg-up-green/10 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-up-green-hc dark:bg-up-green/20 dark:text-up-lime">
            MCP UI
          </span>
        </div>

        <div className="rounded-lg border border-up-border bg-white p-8 shadow-sm dark:border-white/10 dark:bg-white/5">
          {mode === 'signed-in' ? (
            <p className="text-center text-sm font-medium text-up-green-hc dark:text-up-lime" role="status">
              Signed in — redirecting…
            </p>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-up-black dark:text-white">
                {mode === 'setup' ? 'Create your owner password' : 'Log in'}
              </h1>
              <p className="mt-1 text-sm text-up-black/60 dark:text-white/60">
                {mode === 'setup'
                  ? 'First run: set the password for this single-owner deployment.'
                  : 'Enter the password for this deployment.'}
              </p>
              <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4" noValidate>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-up-black dark:text-white">
                    Password
                  </span>
                  <input
                    type="password"
                    autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={INPUT_CLASS}
                    minLength={8}
                    autoFocus
                  />
                </label>
                {mode === 'setup' && (
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-up-black dark:text-white">
                      Confirm password
                    </span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className={INPUT_CLASS}
                      minLength={8}
                    />
                  </label>
                )}
                {error !== null && (
                  <p role="alert" className="text-sm font-medium text-up-red">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-md bg-up-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-up-green-dark disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? 'Please wait…' : mode === 'setup' ? 'Create password' : 'Log in'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-up-black/50 dark:text-white/50">
          Single-owner deployment · Upwork® trademark of Upwork Global LLC
        </p>
      </div>
    </div>
  );
}
