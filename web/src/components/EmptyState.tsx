import { InboxIcon } from './icons.js';

interface EmptyStateProps {
  title: string;
  description: string;
  plan: string;
}

/**
 * Placeholder section state (plan 05): consistent empty state with a note on
 * which plan delivers the real content. Plans 06/07 replace these.
 */
export function EmptyState({ title, description, plan }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-up-border bg-white px-6 py-20 text-center dark:border-white/15 dark:bg-white/5">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-up-surface-2 text-up-teal dark:bg-white/10 dark:text-up-lime">
        <InboxIcon className="h-5 w-5" />
      </div>
      <h1 className="mt-4 text-lg font-semibold text-up-black dark:text-white">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-up-black/60 dark:text-white/60">{description}</p>
      <span className="mt-4 rounded-full bg-up-surface-2 px-3 py-1 text-xs font-medium text-up-teal dark:bg-white/10 dark:text-up-lime">
        Arriving in {plan}
      </span>
    </div>
  );
}
