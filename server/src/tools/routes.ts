import { Hono, type Context } from 'hono';
import { AppError } from '../errors.js';
import type { ToolService } from './service.js';
import { hashArgs, type ToolCallLog } from './store.js';

export interface ToolRoutesDeps {
  service: ToolService;
  log: ToolCallLog;
}

/**
 * Tool proxy routes (plan 04), mounted at `/api`:
 *  - GET  /tools            — tools/list (TTL-cached; `?refresh=1` forces)
 *  - GET  /tools/calls      — recent call log (paginated; args are hashes only)
 *  - POST /tools/:name/call — tools/call with `{ args }` body
 *
 * Error mapping is owned by ToolService (400/404/401/409/429/502/504);
 * every attempt (success or mapped failure) leaves one `tool_calls` row —
 * PII-safe: only the sha256 args hash is stored.
 */
export function createToolRoutes(deps: ToolRoutesDeps): Hono {
  const { service, log } = deps;
  const app = new Hono();

  app.get('/tools', async (c) => {
    const refresh = ['1', 'true'].includes(c.req.query('refresh') ?? '');
    return c.json(await service.listTools({ refresh }));
  });

  app.get('/tools/calls', (c) => {
    const params = new URL(c.req.url, 'http://localhost').searchParams;
    const limit = clampInt(params.get('limit'), 50, 1, 200);
    const offset = clampInt(params.get('offset'), 0, 0, 10_000);
    const { items, hasMore } = log.recent(limit, offset);
    return c.json({ items, limit, offset, hasMore });
  });

  app.post('/tools/:name/call', async (c) => {
    const name = c.req.param('name');
    const body = await readJson(c);
    const args = readToolArgs(body);
    const started = Date.now();
    try {
      const result = await service.callTool(name, args);
      log.record({
        tool: name,
        argsHash: hashArgs(args),
        statusCode: 200,
        ms: result.ms,
      });
      return c.json(result);
    } catch (err) {
      const appErr = err instanceof AppError ? err : null;
      log.record({
        tool: name,
        argsHash: hashArgs(args),
        statusCode: appErr ? appErr.status : 500,
        ms: Date.now() - started,
        errorClass: appErr ? appErr.code : 'internal_error',
      });
      throw err;
    }
  });

  return app;
}

/** `args` is optional in the body; when present it must be a JSON object. */
function readToolArgs(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('bad_request', 'Request body must be a JSON object');
  }
  const maybe = body as Record<string, unknown>;
  if (!('args' in maybe) || maybe.args === undefined) return {};
  const args = maybe.args;
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new AppError('bad_request', 'args must be a JSON object');
  }
  return args as Record<string, unknown>;
}

async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === '') throw new AppError('bad_request', 'Request body is required');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError('bad_request', 'Request body must be valid JSON');
  }
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw === null || raw === '' ? fallback : Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
