export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'conflict'
  | 'rate_limited'
  | 'upstream_error'
  | 'gateway_timeout'
  | 'internal_error';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  rate_limited: 429,
  upstream_error: 502,
  gateway_timeout: 504,
  internal_error: 500,
};

/** App-level error with a stable machine-readable code for the error envelope. */
export class AppError extends Error {
  readonly status: number;
  readonly retryAfterSec?: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    retryAfterSec?: number,
  ) {
    super(message);
    this.status = STATUS_BY_CODE[code];
    this.retryAfterSec = retryAfterSec;
  }
}

/** Standard error envelope: { error: { code, message } }. */
export function errorBody(code: ErrorCode, message: string): { error: { code: ErrorCode; message: string } } {
  return { error: { code, message } };
}
