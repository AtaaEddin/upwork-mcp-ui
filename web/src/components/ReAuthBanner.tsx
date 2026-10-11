import { useCallback, useEffect, useState } from 'react';
import { connectToUpwork, shouldShowReAuthBanner, type UpworkStatus } from '../lib/upwork.js';
import { AlertIcon } from './icons.js';

interface ReAuthBannerProps {
  status: UpworkStatus;
  /** Increments after every status check — "Dismiss" lasts until the next check. */
  checkCount: number;
}

function bannerMessage(status: UpworkStatus): string {
  return status.state === 'needs_reauth'
    ? 'Your Upwork connection expired. Reconnect to keep jobs, messages, and earnings in sync.'
    : 'You are not connected to Upwork. Connect to search jobs, send proposals, and read messages.';
}

/**
 * Re-auth notification (plan 05 core requirement). Red sticky strip shown on
 * explicit `needs_reauth`/`disconnected` (never on `unknown`). Reconnect
 * posts to `/api/upwork/connect` (plan 03) and follows the issued authorize
 * URL in the top-level window — the endpoint answers with JSON
 * `{ authorizeUrl }`, so the navigation happens client-side.
 */
export function ReAuthBanner({ status, checkCount }: ReAuthBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // "Dismiss until next check": every completed status check re-shows the
  // banner if the state still requires action.
  useEffect(() => {
    setDismissed(false);
  }, [checkCount]);

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

  if (!shouldShowReAuthBanner(status, dismissed)) return null;

  return (
    <div role="alert" className="w-full bg-up-red text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <AlertIcon className="h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1 text-sm font-medium">{bannerMessage(status)}</p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void startConnect()}
            disabled={connecting}
            className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-up-red transition-colors hover:bg-white/90 disabled:opacity-60"
          >
            {connecting ? 'Starting…' : 'Reconnect to Upwork'}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded-md px-2 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      </div>
      {connectError !== null && (
        <div className="mx-auto w-full max-w-6xl px-4 pb-2.5">
          <p className="text-xs text-white/90">{connectError}</p>
        </div>
      )}
    </div>
  );
}
