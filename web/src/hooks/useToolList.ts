import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';
import type { ToolInfo } from '../lib/tools.js';

export interface ToolListState {
  tools: ToolInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Live `tools/list` (plan 06, D6.1). Fetched once per mount while connected;
 * the server caches it for 60s, so this is cheap and also feeds the tool
 * name resolution (`resolveTool`).
 */
export function useToolList(enabled: boolean): ToolListState {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setTools([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await apiFetch<{ tools: ToolInfo[] }>('/api/tools');
        if (cancelled) return;
        setTools(res.tools);
      } catch {
        if (!cancelled) setError('Could not load the tools list. Retry below.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { tools, loading, error, refresh };
}

export function isToolAvailable(tools: ToolInfo[], name: string): boolean {
  return tools.some((t) => t.name === name);
}

export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}
