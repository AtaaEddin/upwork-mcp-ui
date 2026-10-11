import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../context/auth.js';

/**
 * Single-owner account menu: shows the signed-in role and offers logout.
 * Closes on Escape, outside click, or navigation.
 */
export function AccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (e: MouseEvent | TouchEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open]);

  const onLogout = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-up-green text-sm font-semibold text-white transition-colors hover:bg-up-green-dark"
      >
        {user !== null ? (
          <span aria-hidden="true">O</span>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="h-4 w-4">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
          </svg>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-50 w-52 overflow-hidden rounded-md border border-up-border bg-white shadow-lg dark:border-white/15 dark:bg-[#222222]"
        >
          <p className="border-b border-up-border px-3 py-2 text-xs text-up-black/60 dark:border-white/10 dark:text-white/60">
            Signed in as <span className="font-semibold">Owner</span>
          </p>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => {
              void onLogout();
            }}
            className="block w-full px-3 py-2 text-left text-sm font-medium text-up-red transition-colors hover:bg-up-surface-2 dark:hover:bg-white/10 disabled:opacity-60"
          >
            {busy ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      )}
    </div>
  );
}
