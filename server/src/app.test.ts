import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { OwnerAuth } from './auth.js';
import { loadConfig, type AppConfig } from './config.js';
import { openDatabase } from './db.js';
import { RateLimiter } from './rate-limit.js';
import { SessionService } from './sessions.js';

interface TestApp {
  app: ReturnType<typeof createApp>;
  config: AppConfig;
  dir: string;
  auth: OwnerAuth;
  sessions: SessionService;
}

function makeApp(overrides: Record<string, string> = {}, opts: { static?: boolean } = {}): TestApp {
  const dir = mkdtempSync(path.join(tmpdir(), 'uwmcui-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dir,
    SESSION_TTL_MS: '60000',
    ...overrides,
  } as NodeJS.ProcessEnv);
  const db = openDatabase(config.DATA_DIR);
  const sessions = new SessionService(db, 60_000);
  const auth = new OwnerAuth(db, sessions, config.OWNER_PASSWORD);
  auth.bootstrap();
  const loginLimiter = new RateLimiter(15 * 60 * 1000, 5);
  let staticDir: string | undefined;
  if (opts.static) {
    staticDir = path.join(dir, 'static');
    mkdirSync(path.join(staticDir, 'assets'), { recursive: true });
    writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>app</title>root');
    writeFileSync(path.join(staticDir, 'assets', 'app.js'), 'console.log(1);');
  }
  const app = createApp({ config, auth, sessions, loginLimiter, staticDir });
  return { app, config, dir, auth, sessions };
}

function cookieOf(res: Response): string | undefined {
  const raw = res.headers.get('set-cookie');
  if (!raw) return undefined;
  const m = raw.match(/session=([^;]+)/);
  return m ? m[1] : undefined;
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function codeOf(body: Record<string, unknown>): string {
  return (body.error as { code: string }).code;
}

const jsonHeaders = { 'content-type': 'application/json' };

describe('health', () => {
  it('serves /api/healthz without authentication', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/healthz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(body.service).toBe('upwork-mcp-ui');
  });
});

describe('first-run setup & login', () => {
  it('requires setup on a fresh database', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/setup');
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ required: true });
  });

  it('is not required when OWNER_PASSWORD bootstrapped the owner', async () => {
    const { app } = makeApp({ OWNER_PASSWORD: 'env-owner-pass-1' });
    const res = await app.request('/api/setup');
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ required: false });
  });

  it('creates the owner once, then disables setup', async () => {
    const { app } = makeApp();
    const created = await app.request('/api/setup', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ password: 'correct-horse-9' }),
    });
    expect(created.status).toBe(201);
    expect(cookieOf(created)).toBeTruthy();

    expect(await bodyOf(await app.request('/api/setup'))).toEqual({ required: false });

    const again = await app.request('/api/setup', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ password: 'another-pass-123' }),
    });
    expect(again.status).toBe(404);
  });

  it('rejects weak, malformed, or mis-typed setup payloads', async () => {
    const { app } = makeApp();
    const weak = await app.request('/api/setup', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ password: 'short' }),
    });
    expect(weak.status).toBe(400);

    const badJson = await app.request('/api/setup', {
      method: 'POST',
      headers: jsonHeaders,
      body: '{nope',
    });
    expect(badJson.status).toBe(400);

    const noContentType = await app.request('/api/setup', {
      method: 'POST',
      body: JSON.stringify({ password: 'correct-horse-9' }),
    });
    expect(noContentType.status).toBe(400);
  });

  it('login: wrong password 401, right password 200 + session cookie', async () => {
    const { app } = makeApp({ OWNER_PASSWORD: 'env-owner-pass-1' });
    const bad = await app.request('/api/login', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ password: 'wrong-pass-123' }),
    });
    expect(bad.status).toBe(401);
    expect(codeOf(await bodyOf(bad))).toBe('unauthorized');

    const good = await app.request('/api/login', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ password: 'env-owner-pass-1' }),
    });
    expect(good.status).toBe(200);
    const cookie = cookieOf(good);
    expect(cookie).toBeTruthy();
    expect(good.headers.get('set-cookie')).toMatch(/HttpOnly/);
    expect(good.headers.get('set-cookie')).toMatch(/SameSite=Lax/);
  });

  it('locks repeated failed logins with 429 + Retry-After', async () => {
    const { app } = makeApp({ OWNER_PASSWORD: 'env-owner-pass-1' });
    const body = JSON.stringify({ password: 'wrong-pass-123' });
    for (let i = 0; i < 5; i += 1) {
      const res = await app.request('/api/login', { method: 'POST', headers: jsonHeaders, body });
      expect(res.status).toBe(401);
    }
    const blocked = await app.request('/api/login', { method: 'POST', headers: jsonHeaders, body });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(codeOf(await bodyOf(blocked))).toBe('rate_limited');
  });

  it('rate limit is keyed by client IP (X-Forwarded-For)', async () => {
    const { app } = makeApp({ OWNER_PASSWORD: 'env-owner-pass-1' });
    const body = JSON.stringify({ password: 'wrong-pass-123' });
    for (let i = 0; i < 5; i += 1) {
      await app.request('/api/login', {
        method: 'POST',
        headers: { ...jsonHeaders, 'x-forwarded-for': '1.2.3.4' },
        body,
      });
    }
    const blocked = await app.request('/api/login', {
      method: 'POST',
      headers: { ...jsonHeaders, 'x-forwarded-for': '1.2.3.4' },
      body,
    });
    expect(blocked.status).toBe(429);
    // different client IP is unaffected
    const other = await app.request('/api/login', {
      method: 'POST',
      headers: { ...jsonHeaders, 'x-forwarded-for': '5.6.7.8' },
      body,
    });
    expect(other.status).toBe(401);
  });
});

describe('session (me/logout)', () => {
  it('me: 401 without session, 200 with session', async () => {
    const { app } = makeApp({ OWNER_PASSWORD: 'env-owner-pass-1' });
    const anon = await app.request('/api/me');
    expect(anon.status).toBe(401);
    expect(codeOf(await bodyOf(anon))).toBe('unauthorized');

    const login = await app.request('/api/login', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ password: 'env-owner-pass-1' }),
    });
    const cookie = cookieOf(login);
    expect(cookie).toBeTruthy();
    const me = await app.request('/api/me', { headers: { cookie: `session=${cookie}` } });
    expect(me.status).toBe(200);
    const meBody = await bodyOf(me);
    expect(meBody.authenticated).toBe(true);
    expect(meBody.owner).toBe(true);
  });

  it('logout revokes the session', async () => {
    const { app } = makeApp({ OWNER_PASSWORD: 'env-owner-pass-1' });
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ password: 'env-owner-pass-1' }),
    });
    const cookie = cookieOf(login);
    const out = await app.request('/api/logout', { method: 'POST', headers: { cookie: `session=${cookie}` } });
    expect(out.status).toBe(200);
    expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0/);

    const me = await app.request('/api/me', { headers: { cookie: `session=${cookie}` } });
    expect(me.status).toBe(401);
  });

  it('logout without a session is 401', async () => {
    const { app } = makeApp({ OWNER_PASSWORD: 'env-owner-pass-1' });
    const res = await app.request('/api/logout', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});

describe('API protection', () => {
  it('unknown /api route: 401 unauthenticated, 404 authenticated', async () => {
    const { app } = makeApp({ OWNER_PASSWORD: 'env-owner-pass-1' });
    const anon = await app.request('/api/definitely-missing');
    expect(anon.status).toBe(401);

    const login = await app.request('/api/login', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ password: 'env-owner-pass-1' }),
    });
    const cookie = cookieOf(login);
    const res = await app.request('/api/definitely-missing', { headers: { cookie: `session=${cookie}` } });
    expect(res.status).toBe(404);
    expect(codeOf(await bodyOf(res))).toBe('not_found');
  });

  it('method not allowed: 405 with envelope (authenticated)', async () => {
    const { app } = makeApp({ OWNER_PASSWORD: 'env-owner-pass-1' });
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ password: 'env-owner-pass-1' }),
    });
    const cookie = cookieOf(login);
    const res = await app.request('/api/healthz', { method: 'POST', headers: { cookie: `session=${cookie}` } });
    expect(res.status).toBe(405);
    expect(codeOf(await bodyOf(res))).toBe('method_not_allowed');
  });

  it('error envelope shape: { error: { code, message } }', async () => {
    const { app } = makeApp({ OWNER_PASSWORD: 'env-owner-pass-1' });
    const res = await app.request('/api/me');
    const body = await bodyOf(res);
    expect(Object.keys(body)).toEqual(['error']);
    const err = body.error as { code: string; message: string };
    expect(err.code).toBe('unauthorized');
    expect(typeof err.message).toBe('string');
  });
});

describe('static SPA serving', () => {
  it('serves index.html at / and for SPA client-side routes', async () => {
    const { app } = makeApp({}, { static: true });
    const root = await app.request('/');
    expect(root.status).toBe(200);
    expect(root.headers.get('content-type')).toContain('text/html');
    expect(await root.text()).toContain('<title>app</title>');

    const spa = await app.request('/jobs/123');
    expect(spa.status).toBe(200);
    expect(spa.headers.get('content-type')).toContain('text/html');
  });

  it('serves existing assets with the right content type', async () => {
    const { app } = makeApp({}, { static: true });
    const js = await app.request('/assets/app.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('javascript');
  });

  it('missing static files fall back to index.html (SPA)', async () => {
    const { app } = makeApp({}, { static: true });
    const res = await app.request('/missing.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('traversal attempts never leak files outside the static root', async () => {
    const { app } = makeApp({}, { static: true });
    const attempts = ['/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2f..%2fetc/passwd', '/etc/passwd'];
    for (const p of attempts) {
      const res = await app.request(p);
      const text = await res.text();
      expect(text).not.toContain('root:'); // never the contents of /etc/passwd
      if (res.status === 404) {
        expect((JSON.parse(text) as { error: { code: string } }).error.code).toBe('not_found');
      } else {
        expect(res.status).toBe(200);
        expect(text).toContain('<title>app</title>'); // SPA fallback
      }
    }
  });

  it('without a built SPA, non-API paths fall through to 404 JSON', async () => {
    const { app } = makeApp();
    const res = await app.request('/whatever');
    expect(res.status).toBe(404);
    const body = await bodyOf(res);
    expect(codeOf(body)).toBe('not_found');
  });

  it('/api paths never leak the SPA fallback', async () => {
    const { app } = makeApp({}, { static: true });
    const res = await app.request('/api/healthz');
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

describe('loadConfig', () => {
  it('requires APP_SECRET (32+) in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/APP_SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'production', APP_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(
      /APP_SECRET/,
    );
  });

  it('accepts a strong production secret', () => {
    const cfg = loadConfig({ NODE_ENV: 'production', APP_SECRET: 'a'.repeat(32) } as NodeJS.ProcessEnv);
    expect(cfg.APP_SECRET).toHaveLength(32);
  });

  it('generates an ephemeral secret outside production', () => {
    const cfg = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    expect(cfg.APP_SECRET).toHaveLength(64);
  });

  it('enforces OWNER_PASSWORD minimum length', () => {
    expect(() => loadConfig({ OWNER_PASSWORD: 'short' } as NodeJS.ProcessEnv)).toThrow();
  });

  it('enforces SESSION_TTL_MS sanity', () => {
    expect(() => loadConfig({ SESSION_TTL_MS: '-5' } as NodeJS.ProcessEnv)).toThrow();
  });

  it('treats empty env values as unset (compose passes listed vars even when empty)', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      APP_SECRET: 'a'.repeat(32),
      OWNER_PASSWORD: '',
      SESSION_TTL_MS: '',
      UPWORK_KEEPALIVE_MS: '',
      PUBLIC_BASE_URL: '',
    } as NodeJS.ProcessEnv);
    expect(cfg.OWNER_PASSWORD).toBeUndefined();
    expect(cfg.SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(cfg.UPWORK_KEEPALIVE_MS).toBe(300_000);
    expect(cfg.PUBLIC_BASE_URL).toBeUndefined();
  });
});
