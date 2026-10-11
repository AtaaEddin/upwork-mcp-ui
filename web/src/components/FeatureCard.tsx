import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { FeatureState } from '../hooks/useFeature.js';

/**
 * Independent card for one dashboard/section feature (plan 06, D6.1):
 * a missing tool or a tool error degrades this card only — never the page.
 */
export function FeatureCard({
  title,
  state,
  tool,
  onRetry,
  render,
}: {
  title: string;
  state: FeatureState;
  /** Tool name shown in the unavailable state (the first candidate). */
  tool?: string;
  onRetry?: () => void;
  render: (data: unknown) => ReactNode;
}) {
  return (
    <section className="rounded-lg border border-up-border bg-white p-4 dark:border-white/15 dark:bg-white/5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
        {title}
      </h2>
      <div className="mt-2">
        {state.kind === 'idle' && (
          <p className="text-sm text-up-black/50 dark:text-white/50">
            Waiting for your Upwork account…
          </p>
        )}
        {state.kind === 'pending' && (
          <p className="text-sm text-up-black/50 dark:text-white/50">Loading…</p>
        )}
        {state.kind === 'unavailable' && (
          <p className="text-sm text-up-black/60 dark:text-white/60">
            This section depends on a tool that is not in the live list
            {tool !== undefined ? ` (${tool})` : ''}. See the{' '}
            <Link to="/tools" className="font-semibold text-up-teal underline dark:text-up-lime">
              tools console
            </Link>
            .
          </p>
        )}
        {state.kind === 'error' && (
          <div>
            <p role="alert" className="text-sm text-up-red">
              {state.message}
            </p>
            {onRetry !== undefined && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-2 rounded-md border border-up-border bg-white px-3 py-1.5 text-xs font-semibold text-up-teal transition-colors hover:bg-up-surface-2 dark:border-white/15 dark:bg-white/5 dark:text-up-lime dark:hover:bg-white/10"
              >
                Retry
              </button>
            )}
          </div>
        )}
        {state.kind === 'ok' && render(state.data)}
      </div>
    </section>
  );
}
