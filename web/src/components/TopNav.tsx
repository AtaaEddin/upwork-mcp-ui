import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import type { UpworkStatus } from '../lib/upwork.js';
import { AccountMenu } from './AccountMenu.js';
import { CloseIcon, MenuIcon } from './icons.js';
import { StatusPill } from './StatusPill.js';
import { ThemeToggle } from './ThemeToggle.js';

const NAV_ITEMS: ReadonlyArray<{ to: string; label: string; end?: boolean }> = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/jobs', label: 'Jobs' },
  { to: '/proposals', label: 'Proposals' },
  { to: '/invitations', label: 'Invitations' },
  { to: '/messages', label: 'Messages' },
  { to: '/contracts', label: 'Contracts' },
  { to: '/profile', label: 'Profile' },
  { to: '/tools', label: 'Tools' },
];

function navLinkClass(isActive: boolean): string {
  return `rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
    isActive
      ? 'text-up-black underline decoration-up-green decoration-2 underline-offset-[6px] dark:text-white'
      : 'text-up-black/60 hover:bg-up-surface-2 hover:text-up-black dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white'
  }`;
}

/**
 * Sticky top nav: upwork wordmark, section links (desktop ≥ lg, hamburger
 * below), status pill, theme toggle, account menu.
 */
export function TopNav({ status }: { status: UpworkStatus }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close the mobile panel on navigation and on Escape.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="border-b border-up-border bg-white dark:border-white/10 dark:bg-up-black">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4">
        <Link
          to="/"
          className="shrink-0 text-2xl font-bold tracking-tight text-up-black dark:text-white"
          aria-label="Upwork MCP UI — home"
        >
          upwork
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => navLinkClass(isActive)}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <StatusPill status={status} />
          <ThemeToggle />
          <div className="hidden sm:block">
            <AccountMenu />
          </div>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-up-border text-up-black/70 transition-colors hover:bg-up-surface-2 lg:hidden dark:border-white/15 dark:text-white/70 dark:hover:bg-white/10"
          >
            {open ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div
          id="mobile-nav"
          className="border-t border-up-border bg-white dark:border-white/10 dark:bg-up-black"
        >
          <nav aria-label="Mobile" className="mx-auto grid w-full max-w-6xl gap-1 px-4 py-3">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => navLinkClass(isActive)}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center justify-between border-t border-up-border px-4 py-3 dark:border-white/10">
            <span className="text-sm font-medium text-up-black/60 dark:text-white/60">Account</span>
            <AccountMenu />
          </div>
        </div>
      )}
    </div>
  );
}
