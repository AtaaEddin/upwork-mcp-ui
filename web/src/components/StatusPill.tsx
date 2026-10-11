import {
  connectionDotClass,
  connectionLabel,
  connectionShortLabel,
  type UpworkStatus,
} from '../lib/upwork.js';

/**
 * Compact connection indicator for the nav:
 * green = connected, yellow = connecting, red = needs re-auth, gray =
 * disconnected/unknown. Full label via aria-label/title.
 */
export function StatusPill({ status }: { status: UpworkStatus }) {
  const label = connectionLabel(status);
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className="inline-flex items-center gap-1.5 rounded-full border border-up-border bg-white px-2.5 py-1 text-xs font-medium text-up-black/70 dark:border-white/15 dark:bg-white/5 dark:text-white/70"
    >
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${connectionDotClass(status)}`} />
      <span className="hidden whitespace-nowrap sm:inline">{connectionShortLabel(status)}</span>
    </span>
  );
}
