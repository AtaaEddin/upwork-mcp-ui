import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CloseIcon } from './icons.js';

/**
 * Outcome of a confirmed write action (plan 07, D7.4):
 * - `proceed` — success; the modal closes and the page continues (its own
 *   result view/toast takes over).
 * - `done`   — show the built-in done view (message + optional
 *   `finalizeUrl` "finish on upwork.com" link).
 */
export type ConfirmOutcome =
  | { status: 'proceed' }
  | { status: 'done'; message: string; finalizeUrl?: string };

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  /** Exactly what will happen + Connects/cost where known (plan 07 scope). */
  summary: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<ConfirmOutcome>;
  onClose: () => void;
}

type Phase = 'confirm' | 'running' | 'done' | 'error';

/**
 * Confirm dialog for EVERY write action (plan 07, D7.4): shows exactly what
 * will happen, runs the action only on explicit confirm, renders the
 * outcome (success / `finalize_url` / error). No auto-confirm anywhere —
 * this app never auto-confirms binding actions.
 */
export function ConfirmModal({
  open,
  title,
  summary,
  confirmLabel = 'Confirm',
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const [phase, setPhase] = useState<Phase>('confirm');
  const [done, setDone] = useState<Extract<ConfirmOutcome, { status: 'done' }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset the outcome while CLOSED (not on open): the component instance
  // survives across open/close (it renders null when closed), and a stale
  // `done`/`error` state would flash for one frame on the next open before
  // an effect-driven reset lands — including on the same modal reused for
  // a different action (e.g. the shared OfferActions across list rows).
  useEffect(() => {
    if (!open) {
      setPhase('confirm');
      setDone(null);
      setError(null);
    }
  }, [open]);

  // Focus the dialog on open; ESC closes from the confirm phase only.
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && phase === 'confirm') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, phase, onClose]);

  const run = useCallback(async () => {
    setPhase('running');
    setError(null);
    try {
      const outcome = await onConfirm();
      if (outcome.status === 'done') {
        setDone(outcome);
        setPhase('done');
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setPhase('error');
    }
  }, [onConfirm, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        tabIndex={-1}
        className="w-full max-w-lg rounded-lg border border-up-border bg-white p-5 shadow-lg outline-none dark:border-white/15 dark:bg-up-black"
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id="confirm-modal-title"
            className="text-lg font-semibold text-up-black dark:text-white"
          >
            {title}
          </h2>
          {phase === 'confirm' && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="rounded p-1 text-up-black/40 transition-colors hover:bg-up-surface-2 hover:text-up-black dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        {phase === 'confirm' && (
          <>
            <div className="mt-3 text-sm text-up-black/80 dark:text-white/80">{summary}</div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-up-border bg-white px-4 py-2 text-sm font-semibold text-up-teal transition-colors hover:bg-up-surface-2 dark:border-white/15 dark:bg-transparent dark:text-up-lime dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void run()}
                className="rounded-md bg-up-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-up-green-dark"
              >
                {confirmLabel}
              </button>
            </div>
          </>
        )}

        {phase === 'running' && (
          <div className="mt-3">
            <p role="status" className="text-sm text-up-black/80 dark:text-white/80">
              Working… this should only take a moment.
            </p>
          </div>
        )}

        {phase === 'done' && done !== null && (
          <div className="mt-3">
            <p className="text-sm font-medium text-up-black dark:text-white">{done.message}</p>
            {done.finalizeUrl !== undefined && (
              <a
                href={done.finalizeUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-3 inline-block rounded-md bg-up-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-up-green-dark"
              >
                Finish on upwork.com
              </a>
            )}
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-up-border bg-white px-4 py-2 text-sm font-semibold text-up-teal transition-colors hover:bg-up-surface-2 dark:border-white/15 dark:bg-transparent dark:text-up-lime dark:hover:bg-white/10"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="mt-3">
            <p role="alert" className="text-sm text-up-red">
              {error}
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-up-border bg-white px-3 py-2 text-sm font-semibold text-up-teal transition-colors hover:bg-up-surface-2 dark:border-white/15 dark:bg-transparent dark:text-up-lime dark:hover:bg-white/10"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void run()}
                className="rounded-md bg-up-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-up-green-dark"
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
