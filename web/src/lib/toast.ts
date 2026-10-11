/**
 * Result toasts (plan 07, D7.4): a tiny pub/sub bus so any page can surface
 * write-action results ("Proposal submitted", errors, …) without prop
 * drilling. `ToastHost` (mounted in `Layout`) renders the queue; a host
 * without subscribers is a no-op (unit-test friendly).
 */

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ToastInput {
  kind: ToastKind;
  message: string;
}

type ToastListener = (toast: ToastInput) => void;

const listeners = new Set<ToastListener>();

/** Emit a toast to every mounted host. */
export function toast(kind: ToastKind, message: string): void {
  for (const listener of listeners) listener({ kind, message });
}

export function toastSuccess(message: string): void {
  toast('success', message);
}

export function toastError(message: string): void {
  toast('error', message);
}

export function toastInfo(message: string): void {
  toast('info', message);
}

/** Subscribe; returns the unsubscribe function. */
export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
