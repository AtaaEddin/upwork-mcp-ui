import { apiFetch } from './api.js';

/**
 * Types + pure logic for the Upwork connection status.
 * The API contract (`GET /api/upwork/status`) is defined in plan 03; this
 * module keeps the client defensive so the shell works both before and
 * after plan 03 lands.
 */
export type UpworkConnectionState = 'connected' | 'connecting' | 'disconnected' | 'needs_reauth';

export type UpworkStatus =
  | { state: 'unknown' }
  | { state: UpworkConnectionState; expiresAt?: string; accountSummary?: string };

const CONNECTION_STATES: ReadonlySet<string> = new Set([
  'connected',
  'connecting',
  'disconnected',
  'needs_reauth',
]);

/** Parse an unknown `/api/upwork/status` payload; anything unexpected → unknown. */
export function parseUpworkStatus(raw: unknown): UpworkStatus {
  if (typeof raw !== 'object' || raw === null) return { state: 'unknown' };
  const rec = raw as Record<string, unknown>;
  const state = rec.state;
  if (typeof state !== 'string' || !CONNECTION_STATES.has(state)) return { state: 'unknown' };
  const expiresAt = typeof rec.expiresAt === 'string' ? rec.expiresAt : undefined;
  const accountSummary = typeof rec.accountSummary === 'string' ? rec.accountSummary : undefined;
  return { state: state as UpworkConnectionState, expiresAt, accountSummary };
}

/**
 * Re-auth banner visibility (plan 05): explicit `needs_reauth`/`disconnected`
 * only. `unknown` (endpoint absent, network down, plan 03 not deployed) never
 * triggers a false re-auth prompt. `dismissed` lasts until the next check.
 */
export function shouldShowReAuthBanner(status: UpworkStatus, dismissed: boolean): boolean {
  if (dismissed) return false;
  return status.state === 'needs_reauth' || status.state === 'disconnected';
}

export function connectionLabel(status: UpworkStatus): string {
  switch (status.state) {
    case 'connected':
      return 'Connected to Upwork';
    case 'connecting':
      return 'Connecting to Upwork…';
    case 'needs_reauth':
      return 'Upwork needs re-authentication';
    case 'disconnected':
      return 'Not connected to Upwork';
    case 'unknown':
      return 'Upwork status unknown';
  }
}

/** Short label for the nav status pill (hidden on very small screens). */
export function connectionShortLabel(status: UpworkStatus): string {
  switch (status.state) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting…';
    case 'needs_reauth':
      return 'Re-auth';
    case 'disconnected':
      return 'Disconnected';
    case 'unknown':
      return '…';
  }
}

export function connectionDotClass(status: UpworkStatus): string {
  switch (status.state) {
    case 'connected':
      return 'bg-up-green';
    case 'connecting':
      return 'bg-up-yellow';
    case 'needs_reauth':
      return 'bg-up-red';
    case 'disconnected':
      return 'bg-gray-400 dark:bg-gray-500';
    case 'unknown':
      return 'bg-gray-400 dark:bg-gray-500';
  }
}

/** Response of `POST /api/upwork/connect` (plan 03 contract). */
export interface ConnectResponse {
  /** Present unless the connection is already established. */
  authorizeUrl?: string;
  state?: string;
}

/**
 * One-click reconnect (plan 05 requirement, used by the re-auth banner and
 * the tools console CTA): start the OAuth flow and follow the issued
 * authorize URL in the top-level window. The server answers with JSON (not
 * a 3xx), so the browser must follow the URL client-side. `navigate` is
 * injectable for tests.
 */
export async function connectToUpwork(navigate?: (url: string) => void): Promise<void> {
  const res = await apiFetch<ConnectResponse>('/api/upwork/connect', { method: 'POST' });
  if (res !== null && typeof res === 'object' && typeof res.authorizeUrl === 'string' && res.authorizeUrl !== '') {
    (navigate ?? ((u: string): void => {
      window.location.assign(u);
    }))(res.authorizeUrl);
  }
}
