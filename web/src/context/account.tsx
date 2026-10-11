import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch, ApiError } from '../lib/api.js';
import { useUpworkStatus } from '../hooks/useUpworkStatus.js';

/** Mirrors the server's `UpworkAccount` (plan 06). */
export interface UpworkAccountInfo {
  orgUid: string;
  name: string;
  role: string;
  roleLabel: string;
  suspended: boolean;
}

interface AccountContextValue {
  /** The currently selected account (null ⇒ nothing selected / not connected). */
  account: UpworkAccountInfo | null;
  /** All listed accounts (empty until a bootstrap/refresh has happened). */
  accounts: UpworkAccountInfo[];
  /** True while the initial bootstrap is running (connected, no selection yet). */
  loading: boolean;
  error: string | null;
  /** Re-fetch the selection; `force` lists accounts upstream again. */
  refresh: (force?: boolean) => Promise<void>;
  /** Select another account (validated server-side). */
  select: (orgUid: string) => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

interface AccountPayload {
  account: UpworkAccountInfo | null;
  accounts: UpworkAccountInfo[];
  source: 'stored' | 'bootstrapped' | 'none';
}

function emptyPayload(): AccountPayload {
  return { account: null, accounts: [], source: 'none' };
}

/**
 * Selected-account context (plan 06): one bootstrap per connection, stored
 * server-side; every feature call attaches `org_uid`. Reset when the
 * connection leaves `connected` (the row is dropped server-side on
 * disconnect anyway — double safety).
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  const { status } = useUpworkStatus();
  const connected = status.state === 'connected';
  const [payload, setPayload] = useState<AccountPayload>(emptyPayload());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const fetchAccount = useCallback(
    async (force: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setLoading(true);
      try {
        const res = await apiFetch<AccountPayload>(
          `/api/upwork/account${force ? '?refresh=1' : ''}`,
        );
        setPayload(normalizePayload(res));
        setError(null);
      } catch (err) {
        // 409 (disconnected meanwhile) / 401: reset to empty, keep user in
        // the loop with the standard wording.
        setPayload(emptyPayload());
        setError(
          err instanceof ApiError && err.status !== 409
            ? err.message
            : 'Account information is unavailable right now.',
        );
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [],
  );

  // Bootstrap once per connection; reset when the connection drops.
  const wasConnected = useRef(false);
  useEffect(() => {
    if (connected) {
      if (!wasConnected.current) {
        wasConnected.current = true;
        void fetchAccount(false);
      }
    } else {
      wasConnected.current = false;
      setPayload(emptyPayload());
      setError(null);
    }
  }, [connected, fetchAccount]);

  const select = useCallback(
    async (orgUid: string) => {
      inFlight.current = true;
      setLoading(true);
      try {
        const res = await apiFetch<AccountPayload & { account: UpworkAccountInfo }>(
          '/api/upwork/account',
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ orgUid }),
          },
        );
        setPayload(normalizePayload(res));
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not change the selected account.');
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [],
  );

  const value = useMemo<AccountContextValue>(
    () => ({
      account: payload.account,
      accounts: payload.accounts,
      loading,
      error,
      refresh: (force?: boolean) => fetchAccount(Boolean(force)),
      select,
    }),
    [payload, loading, error, fetchAccount, select],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

function normalizePayload(res: AccountPayload): AccountPayload {
  return {
    account: res.account ?? null,
    accounts: Array.isArray(res.accounts) ? res.accounts : [],
    source: res.source ?? 'none',
  };
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (ctx === null) throw new Error('useAccount must be used inside <AccountProvider>');
  return ctx;
}
