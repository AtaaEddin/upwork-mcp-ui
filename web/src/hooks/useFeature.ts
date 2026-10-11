import { useCallback, useEffect, useState } from 'react';
import {
  callFeature,
  featureErrorMessage,
  type FeatureSpec,
} from '../lib/registry.js';

/**
 * Feature data states (plan 06, D6.1):
 * - 'idle'        — nothing to load yet (no account / feature inactive)
 * - 'pending'     — loading
 * - 'unavailable' — no candidate tool in the live `tools/list`
 * - 'error'       — API or tool error (message is user-safe)
 * - 'ok'          — parsed payload ready for the page's mappers
 */
export type FeatureState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; data: unknown };

export interface UseFeatureResult {
  state: FeatureState;
  /** Re-run the call (same args). */
  reload: () => void;
}

export interface UseFeatureOptions {
  /**
   * True while the live `tools/list` is still loading: a missing tool name
   * then means "wait" (pending), not "unavailable".
   */
  toolsLoading?: boolean;
}

/**
 * Run one feature call (org_uid + action injected by `callFeature`) and
 * track its state. `args` must be a stable object for a given parameter
 * set (pages build it with `useMemo`); `args = null` suspends the call.
 */
export function useFeature(
  spec: FeatureSpec,
  tool: string | null,
  orgUid: string | null,
  args: Record<string, unknown> | null,
  opts: UseFeatureOptions = {},
): UseFeatureResult {
  const [state, setState] = useState<FeatureState>({ kind: 'idle' });
  const [nonce, setNonce] = useState(0);
  const argsKey = args === null ? null : JSON.stringify(args);
  const toolsLoading = opts.toolsLoading === true;

  useEffect(() => {
    if (argsKey === null || orgUid === null) {
      setState({ kind: 'idle' });
      return;
    }
    if (tool === null) {
      setState(toolsLoading ? { kind: 'pending' } : { kind: 'unavailable' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'pending' });
    void (async () => {
      try {
        const data = await callFeature(spec, tool, orgUid, args as Record<string, unknown>);
        if (!cancelled) setState({ kind: 'ok', data });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: 'error',
          message:
            featureErrorMessage(err) ??
            'Something went wrong while loading this section. Retry, or open the tools console.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spec, tool, orgUid, argsKey, nonce, toolsLoading]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { state, reload };
}
