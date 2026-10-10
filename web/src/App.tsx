/**
 * Scaffold placeholder (plan 01).
 * The real shell — nav, login, re-auth banner, feature pages — lands in plans 05–07.
 * Styling already uses the Upwork design tokens from index.css.
 */
export default function App() {
  return (
    <div className="min-h-full">
      <header className="border-b border-up-border bg-white dark:border-white/10 dark:bg-up-black">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
          <span className="text-2xl font-bold tracking-tight text-up-black dark:text-white">
            upwork
          </span>
          <span className="rounded-full bg-up-surface px-3 py-1 text-xs font-medium text-up-teal dark:bg-white/10 dark:text-up-lime">
            MCP UI · scaffold
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-16">
        <h1 className="text-3xl font-bold tracking-tight">Upwork MCP UI</h1>
        <p className="mt-3 max-w-xl text-up-black/70 dark:text-white/70">
          Self-hosted freelancer UI on top of the official Upwork MCP server. Scaffold is in
          place — owner login, Upwork connection with re-auth notification, and feature
          pages land in the next plans.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            className="cursor-not-allowed rounded-md bg-up-green px-4 py-2 text-sm font-semibold text-white opacity-60 hover:bg-up-green-dark"
          >
            Connect Upwork — coming soon
          </button>
          <a
            href="/api/healthz"
            className="rounded-md border border-up-border bg-white px-4 py-2 text-sm font-semibold text-up-teal dark:border-white/20 dark:bg-transparent dark:text-white"
          >
            API health
          </a>
        </div>
      </main>
    </div>
  );
}
