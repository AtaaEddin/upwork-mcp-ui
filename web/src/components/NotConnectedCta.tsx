import { useCallback, useState } from 'react';
import type { UpworkConnectionState } from '../lib/upwork.js';
import { connectToUpwork } from '../lib/upwork.js';

/**
 * Standard "not connected" panel (plan 03 contract, reused by plan 04/06):
 * one-click connect with the same wording the banner uses.
 */
export function NotConnectedCta({
  title,
  state,
}: {
  title: string;
  state: UpworkConnectionState | 'unknown';
}) {
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const startConnect = useCallback(async (): Promise<void> => {
    setConnecting(true);
    setConnectError(null);
    try {
      await connectToUpwork();
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Could not start the Upwork connection.');
    } finally {
      setConnecting(false);
    }
  }, []);

  const message =
    state === 'needs_reauth'
      ? `Your Upwork connection expired. Reconnect to load the ${title}.`
      : state === 'disconnected'
        ? `You are not connected to Upwork. Connect to load the ${title}.`
        : state === 'connecting'
          ? 'Connecting to Upwork… this page loads as soon as the connection completes.'
          : 'Checking your Upwork connection…';

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-up-border bg-white px-6 py-20 text-center dark:border-white/15 dark:bg-white/5">
      <h1 className="text-lg font-semibold text-up-black dark:text-white">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-up-black/60 dark:text-white/60">{message}</p>
      {state === 'disconnected' || state === 'needs_reauth' ? (
        <div className="mt-6 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => void startConnect()}
            disabled={connecting}
            className="rounded-md bg-up-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-up-green-dark disabled:opacity-50"
          >
            {connecting ? 'Starting…' : 'Connect to Upwork'}
          </button>
          {connectError !== null && (
            <p role="alert" className="text-xs text-up-red">
              {connectError}
            </p>
          )}
        </div>
      ) : (
        <span className="mt-6 text-xs text-up-black/50 dark:text-white/50">Please wait…</span>
      )}
    </div>
  );
}
