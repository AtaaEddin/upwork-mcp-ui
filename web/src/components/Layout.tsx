import { Outlet } from 'react-router';
import { useAuth } from '../context/auth.js';
import { useUpworkStatus } from '../hooks/useUpworkStatus.js';
import { ReAuthBanner } from './ReAuthBanner.js';
import { TopNav } from './TopNav.js';
import { ToastHost } from './Toast.js';

/**
 * Authenticated shell: re-auth banner (plan 03 contract) + sticky nav on top,
 * routed section in the middle, ToS footer at the bottom.
 */
export function Layout() {
  const { user } = useAuth();
  const { status, checkCount } = useUpworkStatus({ enabled: user !== null });

  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-up-green focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-50">
        {user !== null && <ReAuthBanner status={status} checkCount={checkCount} />}
        <TopNav status={status} />
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      {/* Result toasts for write actions (plan 07, D7.4). */}
      <ToastHost />
      <footer className="border-t border-up-border bg-white py-4 dark:border-white/10 dark:bg-up-black">
        <p className="mx-auto w-full max-w-6xl px-4 text-center text-xs text-up-black/50 dark:text-white/50">
          Unofficial freelancer UI for the official Upwork MCP server · Upwork® is a trademark of
          Upwork Global LLC
        </p>
      </footer>
    </div>
  );
}
