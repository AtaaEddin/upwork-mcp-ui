import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api.js';
import { parseUpworkStatus, type UpworkStatus } from '../lib/upwork.js';

const DEFAULT_INTERVAL_MS = 30_000;

export interface UseUpworkStatusOptions {
  /** Poll only while an owner session exists (status endpoint requires auth). */
  enabled?: boolean;
  /** Poll interval; 30 s per plan 05. */
  intervalMs?: number;
}

export interface UseUpworkStatusResult {
  status: UpworkStatus;
  /** Increments after every completed check — drives "dismiss until next check". */
  checkCount: number;
  /** Force an immediate check (e.g. after a reconnect round-trip). */
  refresh: () => Promise<void>;
}

/**
 * Polls `GET /api/upwork/status` (plan 03 contract) every `intervalMs` and on
 * tab-visibility change. API errors / absent endpoint (plan 03 not deployed)
 * yield `state: 'unknown'` — never a false re-auth banner.
 */
export function useUpworkStatus(options: UseUpworkStatusOptions = {}): UseUpworkStatusResult {
  const { enabled = true, intervalMs = DEFAULT_INTERVAL_MS } = options;
  const [status, setStatus] = useState<UpworkStatus>({ state: 'unknown' });
  const [checkCount, setCheckCount] = useState(0);
  const inflight = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      try {
        const raw = await apiFetch<unknown>('/api/upwork/status');
        setStatus(parseUpworkStatus(raw));
      } catch {
        // 401/404/500/network → unknown (see plan 05 decision "Status unknown state")
        setStatus({ state: 'unknown' });
      }
    } finally {
      inflight.current = false;
      setCheckCount((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs, refresh]);

  return { status, checkCount, refresh };
}
