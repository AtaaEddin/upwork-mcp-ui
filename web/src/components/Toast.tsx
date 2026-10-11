import { useEffect, useRef, useState } from 'react';
import { subscribeToasts, type ToastKind } from '../lib/toast.js';
import { AlertIcon, CheckIcon, CloseIcon } from './icons.js';

interface HostToast {
  id: number;
  kind: ToastKind;
  message: string;
}

const TOASTS_VISIBLE = 3;
const TOAST_TTL_MS = 6_000;

/**
 * Result-toast host (plan 07, D7.4): fixed bottom-right stack, newest last,
 * auto-dismiss after 6 s, manual close. Mounted once in `Layout`.
 */
export function ToastHost() {
  const [toasts, setToasts] = useState<HostToast[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    const timers = new Set<number>();
    const unsubscribe = subscribeToasts((incoming) => {
      const id = (nextId.current += 1);
      setToasts((prev) => [...prev, { id, ...incoming }].slice(-TOASTS_VISIBLE));
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, TOAST_TTL_MS);
      timers.add(timer);
    });
    return () => {
      unsubscribe();
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  const dismiss = (id: number): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[80] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : undefined}
          className={
            'flex items-start gap-2 rounded-lg border px-3 py-2.5 shadow-sm ' +
            (t.kind === 'error'
              ? 'border-up-red/40 bg-white text-up-red dark:bg-up-black'
              : t.kind === 'success'
                ? 'border-up-green/40 bg-white text-up-black dark:border-up-green/30 dark:bg-up-black dark:text-white'
                : 'border-up-border bg-white text-up-black dark:border-white/15 dark:bg-up-black dark:text-white')
          }
        >
          <span className="mt-0.5 shrink-0">
            {t.kind === 'error' ? (
              <AlertIcon className="h-4 w-4" />
            ) : t.kind === 'success' ? (
              <CheckIcon className="h-4 w-4 text-up-green" />
            ) : (
              <AlertIcon className="h-4 w-4 text-up-teal dark:text-up-lime" />
            )}
          </span>
          <p className="min-w-0 flex-1 text-sm font-medium">{t.message}</p>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
            className="shrink-0 rounded p-0.5 text-up-black/40 transition-colors hover:bg-up-surface-2 hover:text-up-black dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
