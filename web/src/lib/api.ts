/**
 * Thin fetch wrapper around the BFF API (Hono server, plans 02–04).
 * Every non-2xx response uses the server error envelope:
 * `{ error: { code, message } }` — surfaced here as {@link ApiError}.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSec?: number;

  constructor(status: number, code: string, message: string, retryAfterSec?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

/** RequestInit with plain-object headers (kept simple for strict typing). */
export interface ApiInit extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
}

/** JSON fetch: parses the body on success, maps the error envelope to ApiError. */
export async function apiFetch<T>(path: string, init: ApiInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { accept: 'application/json', ...init.headers } });
  } catch {
    throw new ApiError(0, 'network_error', 'Network error — is the server running?');
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    try {
      return (await res.json()) as T;
    } catch {
      throw new ApiError(res.status, 'bad_response', 'Malformed response from server');
    }
  }

  let code = 'error';
  let message = `Request failed (HTTP ${res.status})`;
  try {
    const body = (await res.json()) as { error?: { code?: unknown; message?: unknown } };
    if (typeof body.error?.code === 'string') code = body.error.code;
    if (typeof body.error?.message === 'string') message = body.error.message;
  } catch {
    // non-JSON error body — keep the default message
  }
  const retryRaw = res.headers.get('retry-after');
  const retryAfterSec =
    retryRaw !== null && Number.isFinite(Number(retryRaw)) ? Number(retryRaw) : undefined;
  throw new ApiError(res.status, code, message, retryAfterSec);
}
