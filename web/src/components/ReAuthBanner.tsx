import { useEffect, useState } from 'react';
import { shouldShowReAuthBanner, type UpworkStatus } from '../lib/upwork.js';
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
 * explicit `needs_reauth`/`disconnected` (never on `unknown`). Reconnect is a
 * top-level form POST to `/api/upwork/connect` (plan 03) so the OAuth 302 to
 * Upwork's authorize URL navigates the top-level window (CORS-safe).
 */
export function ReAuthBanner({ status, checkCount }: ReAuthBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  // "Dismiss until next check": every completed status check re-shows the
  // banner if the state still requires action.
  useEffect(() => {
    setDismissed(false);
  }, [checkCount]);

  if (!shouldShowReAuthBanner(status, dismissed)) return null;

  return (
    <div role="alert" className="w-full bg-up-red text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <AlertIcon className="h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1 text-sm font-medium">{bannerMessage(status)}</p>
        <form action="/api/upwork/connect" method="post" className="flex shrink-0 items-center gap-2">
          <button
            type="submit"
            className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-up-red transition-colors hover:bg-white/90"
          >
            Reconnect to Upwork
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded-md px-2 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            Dismiss
          </button>
        </form>
      </div>
    </div>
  );
}
