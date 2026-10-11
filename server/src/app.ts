import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { OwnerAuth } from './auth.js';
import type { AppConfig } from './config.js';
import { AppError, errorBody } from './errors.js';
import type { RateLimiter } from './rate-limit.js';
import type { SessionService } from './sessions.js';
import { createSpaMiddleware } from './static.js';
import { createUpworkRoutes } from './upwork/routes.js';
import type { UpworkConnectionService } from './upwork/service.js';

export const SESSION_COOKIE = 'session';

const PasswordSchema = z.object({
  password: z.string().min(8).max(512),
});

export interface AppDeps {
  config: AppConfig;
  auth: OwnerAuth;
  sessions: SessionService;
  loginLimiter: RateLimiter;
  /** Directory containing the built SPA (web/dist). Omit in dev (Vite serves it). */
  staticDir?: string;
  /** Upwork connection service (plan 03). Omitted ⇒ no /api/upwork routes. */
  upwork?: UpworkConnectionService;
}

type AppEnv = { Variables: { userId: number } };

/** Public API surface (everything else under /api requires a session). */
const PUBLIC_API: Array<[method: string, path: string]> = [
  ['GET', '/api/healthz'],
  ['GET', '/api/setup'],
  ['POST', '/api/setup'],
  ['POST', '/api/login'],
  ['POST', '/api/logout'],
  // The browser lands here from the Upwork authorization server with no session cookie.
  ['GET', '/api/upwork/callback'],
];

/** Known paths → allowed methods, used to answer 405 with the error envelope. */
const KNOWN_METHODS: Record<string, string[]> = {
  '/api/healthz': ['GET'],
  '/api/setup': ['GET', 'POST'],
  '/api/login': ['POST'],
  '/api/logout': ['POST'],
  '/api/me': ['GET'],
  '/api/upwork/connect': ['POST'],
  '/api/upwork/callback': ['GET'],
  '/api/upwork/status': ['GET'],
  '/api/upwork/disconnect': ['POST'],
};

/**
 * Build the HTTP app. Kept separate from the server entry so tests can
 * exercise the full HTTP surface via `app.request()`.
 */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const { config, auth, sessions, loginLimiter } = deps;
  const app = new Hono<AppEnv>();
  const secure = config.NODE_ENV === 'production';

  app.onError((err) => {
    if (err instanceof AppError) {
      const headers: Record<string, string> = {};
      if (err.retryAfterSec !== undefined) headers['retry-after'] = String(err.retryAfterSec);
      return respondJson(err.status, errorBody(err.code, err.message), headers);
    }
    // Never leak internals of unexpected errors.
    console.error('unhandled error:', err);
    return respondJson(500, errorBody('internal_error', 'internal server error'));
  });

  app.notFound((c) => {
    const allowed = KNOWN_METHODS[c.req.path];
    if (allowed && !allowed.includes(c.req.method)) {
      return respondJson(405, errorBody('method_not_allowed', 'method not allowed'));
    }
    return respondJson(404, errorBody('not_found', 'resource not found'));
  });

  if (deps.staticDir) app.use('*', createSpaMiddleware(deps.staticDir));

  // Auth guard: every non-public /api route requires a valid session.
  // (Registered before the /api/upwork sub-app so its routes are guarded too.)
  app.use('/api/*', (c, next) => {
    if (PUBLIC_API.some(([m, p]) => m === c.req.method && p === c.req.path)) return next();
    const userId = sessions.touch(cookies(c)[SESSION_COOKIE]);
    if (userId === null) throw new AppError('unauthorized', 'authentication required');
    c.set('userId', userId);
    return next();
  });

  if (deps.upwork) app.route('/api/upwork', createUpworkRoutes(deps.upwork));

  app.get('/api/healthz', (c) =>
    c.json({
      status: 'ok',
      service: 'upwork-mcp-ui',
      mcpUrl: config.UPWORK_MCP_URL,
      time: new Date().toISOString(),
    }),
  );

  // ---- first-run setup (single owner) ----

  app.get('/api/setup', (c) => c.json({ required: auth.needsSetup }));

  app.post('/api/setup', async (c) => {
    const parsed = PasswordSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new AppError('bad_request', 'password must be 8-512 characters');
    if (!auth.needsSetup) throw new AppError('not_found', 'setup is no longer available');
    const { token, expiresAt } = auth.createOwner(parsed.data.password);
    c.header('Set-Cookie', sessionCookie(token, expiresAt, secure));
    return c.json({ ok: true }, 201);
  });

  // ---- login / logout / me ----

  app.post('/api/login', async (c) => {
    const ip = (c.req.header('x-forwarded-for') ?? 'local').split(',')[0]!.trim() || 'local';
    const retryAfter = loginLimiter.hit(ip);
    if (retryAfter !== null) {
      throw new AppError('rate_limited', 'too many login attempts', retryAfter);
    }
    const parsed = PasswordSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new AppError('bad_request', 'password must be 8-512 characters');
    const result = auth.login(parsed.data.password);
    if (!result) throw new AppError('unauthorized', 'invalid password');
    loginLimiter.reset(ip);
    c.header('Set-Cookie', sessionCookie(result.token, result.expiresAt, secure));
    return c.json({ ok: true });
  });

  app.post('/api/logout', (c) => {
    const token = cookies(c)[SESSION_COOKIE];
    if (!token) throw new AppError('unauthorized', 'no active session');
    sessions.revoke(token);
    c.header('Set-Cookie', clearSessionCookie(secure));
    return c.json({ ok: true });
  });

  app.get('/api/me', (c) => {
    const userId = c.get('userId');
    if (userId === undefined) throw new AppError('unauthorized', 'authentication required');
    return c.json({ authenticated: true, owner: true, userId });
  });

  return app;
}

function respondJson(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function cookies(c: Context): Record<string, string> {
  const raw = c.req.header('cookie');
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

async function readJson(c: Context): Promise<unknown> {
  const type = (c.req.header('content-type') ?? '').toLowerCase();
  if (!type.includes('application/json')) {
    throw new AppError('bad_request', 'content-type must be application/json');
  }
  try {
    return (await c.req.json()) as unknown;
  } catch {
    throw new AppError('bad_request', 'body must be valid JSON');
  }
}

function sessionCookie(token: string, expiresAt: string, secure: boolean): string {
  const maxAge = Math.max(1, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : undefined,
    `Max-Age=${maxAge}`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ]
    .filter(Boolean)
    .join('; ');
}

function clearSessionCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE}=;`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : undefined,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]
    .filter(Boolean)
    .join('; ');
}
