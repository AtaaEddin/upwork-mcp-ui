import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { OwnerAuth } from '../auth.js';
import type { AppConfig } from '../config.js';
import { loadConfig } from '../config.js';
import type { Db } from '../db.js';
import { openDatabase } from '../db.js';
import { RateLimiter } from '../rate-limit.js';
import { SessionService } from '../sessions.js';
import { startFakeUpwork, type FakeUpwork } from './fake-upwork.js';
import { decryptJson, encryptJson } from './crypto.js';
import { UpworkConnectionStore } from './store.js';
import { UpworkConnectionService } from './service.js';

const SECRET = 'test-app-secret-012345678901234567890123456789';
const PASSWORD = 'test-password-12345';
const REDIRECT_URI = 'http://127.0.0.1:1/api/upwork/callback';

interface Harness {
  fake: FakeUpwork;
  db: Db;
  config: AppConfig;
  service: UpworkConnectionService;
  app: ReturnType<typeof createApp>;
  logLines: string[];
}

async function buildHarness(opts: {
  refreshBeforeExpiryMs?: number;
  logLines?: string[];
} = {}): Promise<Harness> {
  const fake = await startFakeUpwork();
  const dir = mkdtempSync(path.join(tmpdir(), 'upwork-mcp-ui-test-'));
  const db = openDatabase(dir);
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_SECRET: SECRET,
    UPWORK_MCP_URL: fake.mcpUrl,
    PUBLIC_BASE_URL: 'http://127.0.0.1:1',
    UPWORK_KEEPALIVE_MS: '5000',
    DATA_DIR: dir,
  });
  const sessions = new SessionService(db);
  const auth = new OwnerAuth(db, sessions, PASSWORD);
  auth.bootstrap();
  const logLines = (opts.logLines ??= []);
  const service = new UpworkConnectionService({
    db,
    config,
    redirectUri: REDIRECT_URI,
    intervalMs: 50,
    refreshBeforeExpiryMs: opts.refreshBeforeExpiryMs,
    log: (m) => logLines.push(m),
  });
  const app = createApp({
    config,
    auth,
    sessions,
    loginLimiter: new RateLimiter(15 * 60 * 1000, 10000),
    upwork: service,
  });
  return { fake, db, config, service, app, logLines };
}

async function login(app: Harness['app']): Promise<string> {
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie') ?? '';
  const token = (cookie.split('=')[1] ?? '').split(';')[0];
  expect(token).toBeTruthy();
  return `session=${token}`;
}

/** Drive the browser step: connect → issue code → callback. */
async function completeConnect(h: Harness, cookie: string): Promise<void> {
  const res = await h.app.request('/api/upwork/connect', { method: 'POST', headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { authorizeUrl: string };
  expect(body.authorizeUrl).toBeTruthy();
  const url = new URL(body.authorizeUrl);
  const code = h.fake.issueCode();
  const state = url.searchParams.get('state') ?? '';
  expect(state).toBeTruthy();
  const cb = await h.app.request(
    `/api/upwork/callback?code=${code}&state=${encodeURIComponent(state)}&iss=${h.fake.issuer}`,
  );
  expect(cb.status).toBe(302);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('upwork crypto', () => {
  it('round-trips a JSON value', () => {
    const blob = encryptJson(SECRET, { a: 1, b: 'x', c: [1, 2, 3] });
    expect(blob.startsWith('v1.')).toBe(true);
    expect(decryptJson(SECRET, blob)).toEqual({ a: 1, b: 'x', c: [1, 2, 3] });
  });

  it('rejects a tampered blob', () => {
    const blob = encryptJson(SECRET, { secret: 'value' });
    const raw = Buffer.from(blob.slice(3), 'base64');
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
    expect(() => decryptJson(SECRET, `v1.${raw.toString('base64')}`)).toThrow();
  });

  it('rejects the wrong secret', () => {
    const blob = encryptJson(SECRET, { secret: 'value' });
    expect(() => decryptJson('another-secret-01234567890123456789012', blob)).toThrow();
  });

  it('rejects malformed blobs', () => {
    expect(() => decryptJson(SECRET, 'nope')).toThrow();
    expect(() => decryptJson(SECRET, 'v1.!!!not-base64!!!')).toThrow();
    expect(() => decryptJson(SECRET, 'v1.' + Buffer.from([0, 1, 2]).toString('base64'))).toThrow();
  });
});

describe('upwork store', () => {
  it('defaults to a disconnected row and round-trips patches', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'upwork-store-'));
    const db = openDatabase(dir);
    const store = new UpworkConnectionStore(db);
    expect(store.get().state).toBe('disconnected');
    store.set({ state: 'connecting', issuer: 'iss-a', tokensEnc: 'enc', flowState: 's' });
    expect(store.get()).toMatchObject({ state: 'connecting', issuer: 'iss-a', flowState: 's' });
    store.clearFlow();
    expect(store.get().flowState).toBeNull();
    store.set({ clientInfoEnc: 'ci' });
    store.clearTokens();
    expect(store.get().tokensEnc).toBeNull();
    expect(store.get().clientInfoEnc).toBe('ci');
    store.clearAll();
    expect(store.get().state).toBe('disconnected');
    expect(store.get().issuer).toBeNull();
    expect(store.get().clientInfoEnc).toBeNull();
  });
});

describe('upwork connection (plan 03)', () => {
  let h: Harness | null = null;

  afterEach(async () => {
    if (!h) return;
    h.service.stop();
    await h.service.dispose().catch(() => undefined);
    await h.fake.close();
    h.db.close();
    h = null;
  });

  it('runs the full connect flow (DCR, PKCE, callback, MCP session)', async () => {
    h = await buildHarness();
    const { fake, service, app } = h;
    const cookie = await login(app);

    const connectRes = await app.request('/api/upwork/connect', { method: 'POST', headers: { cookie } });
    expect(connectRes.status).toBe(200);
    const body = (await connectRes.json()) as { authorizeUrl: string };
    const url = new URL(body.authorizeUrl);
    expect(url.origin).toBe(fake.origin);
    expect(url.pathname).toBe('/authorize');
    expect(url.searchParams.get('client_id')).toBeTruthy();
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('resource')).toBe(fake.mcpUrl);
    expect(fake.registerCount).toBe(1);
    expect(service.status().state).toBe('connecting');

    const code = fake.issueCode();
    const state = url.searchParams.get('state')!;
    const cb = await app.request(
      `/api/upwork/callback?code=${code}&state=${encodeURIComponent(state)}&iss=${fake.issuer}`,
    );
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('/');

    const status = service.status();
    expect(status.state).toBe('connected');
    expect(status.expiresAt).toBeTruthy();
    expect(fake.tokenStats.authorizationCode).toBe(1);
    expect(fake.mcpStats.initialize).toBe(1);
    expect(fake.issuedAccessTokens.length).toBe(1);
  });

  it('rejects a callback with the wrong state (CSRF)', async () => {
    h = await buildHarness();
    const { fake, service, app } = h;
    const cookie = await login(app);
    await app.request('/api/upwork/connect', { method: 'POST', headers: { cookie } });
    const code = fake.issueCode();

    const cb = await app.request(
      `/api/upwork/callback?code=${code}&state=attacker-controlled&iss=${fake.issuer}`,
    );
    expect(cb.status).toBe(400);
    const err = (await cb.json()) as { error: { code: string } };
    expect(err.error.code).toBe('bad_request');
    expect(service.status().state).toBe('disconnected');
  });

  it('rejects an issuer mismatch (RFC 9207 mix-up)', async () => {
    h = await buildHarness();
    const { fake, service, app } = h;
    const cookie = await login(app);
    const connectRes = await app.request('/api/upwork/connect', { method: 'POST', headers: { cookie } });
    const body = (await connectRes.json()) as { authorizeUrl: string };
    const url = new URL(body.authorizeUrl);
    const code = fake.issueCode();

    const cb = await app.request(
      `/api/upwork/callback?code=${code}&state=${url.searchParams.get('state')}&iss=${fake.origin}/evil`,
    );
    expect(cb.status).toBe(400);
    // The code must not have been redeemed.
    expect(fake.tokenStats.authorizationCode).toBe(0);
    expect(service.status().state).toBe('disconnected');
  });

  it('does not leak error_description from the callback', async () => {
    h = await buildHarness();
    const { app } = h;
    const cb = await app.request(
      '/api/upwork/callback?error=access_denied&error_description=<evil>&state=x',
    );
    expect(cb.status).toBe(400);
    const text = JSON.stringify(await cb.clone().json());
    expect(text).not.toContain('evil');
  });

  it('refreshes an expired access token on 401 (SDK path)', async () => {
    h = await buildHarness();
    const { fake, service, app } = h;
    const cookie = await login(app);
    await completeConnect(h, cookie);
    const firstToken = fake.issuedAccessTokens[0];

    fake.invalidateAccessTokens();
    await service.ping();

    // The SDK refreshes on 401. (The transport may 401 two in-flight requests
    // concurrently, e.g. the SSE GET stream + this ping — bounded duplicate
    // refreshes, last write wins; the outcome must still be `connected`.)
    expect(fake.tokenStats.refresh).toBeGreaterThanOrEqual(1);
    expect(service.status().state).toBe('connected');
    expect(fake.lastMcpBearer).not.toBe(firstToken);
  });

  it('refreshes proactively before expiry (provider.tokens window)', async () => {
    const hh = await buildHarness({ refreshBeforeExpiryMs: 2 * 3600 * 1000 });
    h = hh;
    const { fake, service, app } = h;
    const cookie = await login(app);
    const connectRes = await app.request('/api/upwork/connect', { method: 'POST', headers: { cookie } });
    const body = (await connectRes.json()) as { authorizeUrl: string };
    const url = new URL(body.authorizeUrl);
    const cb = await app.request(
      `/api/upwork/callback?code=${fake.issueCode()}&state=${url.searchParams.get('state')}&iss=${fake.issuer}`,
    );
    expect(cb.status).toBe(302);

    // Token TTL is 1 h < 2 h window ⇒ refresh happened before the MCP request.
    expect(fake.tokenStats.refresh).toBeGreaterThanOrEqual(1);
    expect(service.status().state).toBe('connected');
    expect(fake.lastMcpBearer).not.toBe(fake.issuedAccessTokens[0]);
  });

  it('marks needs_reauth when the refresh is dead and stops keepalive', async () => {
    h = await buildHarness();
    const { fake, service, app } = h;
    const cookie = await login(app);
    await completeConnect(h, cookie);

    fake.invalidateAccessTokens();
    fake.failRefresh = true;
    await service.ping();

    expect(service.status().state).toBe('needs_reauth');
    expect(service.status().pendingAuthorizeUrl).toBeTruthy();
    expect(service.status().pendingAuthorizeUrl).toContain(`/authorize?`);

    // Keepalive must not hammer a dead connection.
    const unauthBefore = fake.mcpStats.unauthenticated;
    await sleep(200);
    expect(fake.mcpStats.unauthenticated).toBe(unauthBefore);
  });

  it('reconnects after needs_reauth, reusing the registered client', async () => {
    h = await buildHarness();
    const { fake, service, app } = h;
    const cookie = await login(app);
    await completeConnect(h, cookie);
    fake.invalidateAccessTokens();
    fake.failRefresh = true;
    await service.ping();
    expect(service.status().state).toBe('needs_reauth');

    const res = await app.request('/api/upwork/connect', { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorizeUrl: string };
    expect(fake.registerCount).toBe(1); // DCR client reused
    expect(service.status().state).toBe('connecting');

    const url = new URL(body.authorizeUrl);
    const cb = await app.request(
      `/api/upwork/callback?code=${fake.issueCode()}&state=${url.searchParams.get('state')}&iss=${fake.issuer}`,
    );
    expect(cb.status).toBe(302);
    expect(service.status().state).toBe('connected');
  });

  it('disconnect clears tokens but keeps the registered client', async () => {
    h = await buildHarness();
    const { service, app, db } = h;
    const cookie = await login(app);
    await completeConnect(h, cookie);

    const res = await app.request('/api/upwork/disconnect', { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; revokeHint: string };
    expect(body.ok).toBe(true);
    expect(body.revokeHint).toContain('upwork.com');

    const row = new UpworkConnectionStore(db).get();
    expect(row.tokensEnc).toBeNull();
    expect(row.verifierEnc).toBeNull();
    expect(row.clientInfoEnc).toBeTruthy();
    expect(service.status().state).toBe('disconnected');
  });

  it('survives a process restart with connected state (tokens from DB)', async () => {
    h = await buildHarness();
    const { fake, db, config } = h;
    const cookie = await login(h.app);
    await completeConnect(h, cookie);
    expect(h.service.status().state).toBe('connected');

    await h.service.dispose();
    const service2 = new UpworkConnectionService({
      db,
      config,
      redirectUri: REDIRECT_URI,
      intervalMs: 50,
    });
    expect(service2.status().state).toBe('connected');
    await service2.ping();
    expect(service2.status().state).toBe('connected');
    expect(fake.mcpStats.initialize).toBe(2);
    await service2.dispose();
  });

  it('pings periodically while connected and stops after stop()', async () => {
    h = await buildHarness();
    const { fake, service, app } = h;
    const cookie = await login(app);
    await completeConnect(h, cookie);

    service.start();
    const before = fake.mcpStats.ping;
    await sleep(300);
    const afterTicks = fake.mcpStats.ping;
    expect(afterTicks).toBeGreaterThanOrEqual(before + 3);

    service.stop();
    await sleep(80);
    const stable = fake.mcpStats.ping;
    await sleep(120);
    expect(fake.mcpStats.ping).toBe(stable);
  });

  it('keeps state on repeated keepalive 401 until reconnect (no state flapping)', async () => {
    h = await buildHarness();
    const { fake, service, app } = h;
    const cookie = await login(app);
    await completeConnect(h, cookie);
    fake.invalidateAccessTokens();
    fake.failRefresh = true;
    await service.ping();
    await service.ping(); // must not re-trigger redirect loops
    expect(service.status().state).toBe('needs_reauth');
  });

  it('keeps connected through transient keepalive errors, gives up after the threshold', async () => {
    h = await buildHarness();
    const { fake, service, app } = h;
    const cookie = await login(app);
    await completeConnect(h, cookie);

    // Simulate upstream outages (500s — not 401s, so no re-auth redirect).
    fake.mcpFailWith = 500;
    for (let i = 0; i < 5; i++) await service.ping();
    expect(service.status().state).toBe('connected'); // threshold (6) not reached
    await service.ping();
    expect(service.status().state).toBe('needs_reauth');
  });

  it('keeps state=connected on transient keepalive errors (no re-auth)', async () => {
    h = await buildHarness();
    const { fake, service, app } = h;
    const cookie = await login(app);
    await completeConnect(h, cookie);
    // One transient failure (401 then refresh ok) must not demote to needs_reauth.
    fake.invalidateAccessTokens();
    await service.ping();
    expect(service.status().state).toBe('connected');
  });
});

describe('upwork HTTP surface', () => {
  let h: Harness | null = null;

  afterEach(async () => {
    if (!h) return;
    h.service.stop();
    await h.service.dispose().catch(() => undefined);
    await h.fake.close();
    h.db.close();
    h = null;
  });

  it('requires a session for status/connect/disconnect (envelope)', async () => {
    h = await buildHarness();
    const app = h.app;

    const status = await app.request('/api/upwork/status');
    expect(status.status).toBe(401);
    expect((await status.json())).toEqual({ error: { code: 'unauthorized', message: expect.any(String) } });

    const connect = await app.request('/api/upwork/connect', { method: 'POST' });
    expect(connect.status).toBe(401);

    const disconnect = await app.request('/api/upwork/disconnect', { method: 'POST' });
    expect(disconnect.status).toBe(401);
  });

  it('answers 405 for wrong methods with the envelope (authenticated)', async () => {
    h = await buildHarness();
    const { app } = h;
    const cookie = await login(app);
    const wrongMethod = await app.request('/api/upwork/connect', { headers: { cookie } });
    expect(wrongMethod.status).toBe(405);
    const wrongBody = (await wrongMethod.json()) as { error: { code: string } };
    expect(wrongBody.error.code).toBe('method_not_allowed');
  });

  it('serves status publicly-shaped after login and reports machine states', async () => {
    h = await buildHarness();
    const { app, fake } = h;
    const cookie = await login(app);

    const res = await app.request('/api/upwork/status', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await res.json())).toMatchObject({ state: 'disconnected' });

    const connectRes = await app.request('/api/upwork/connect', { method: 'POST', headers: { cookie } });
    expect(connectRes.status).toBe(200);

    const after = await app.request('/api/upwork/status', { headers: { cookie } });
    const body = (await after.json()) as { state: string; pendingAuthorizeUrl?: string };
    expect(body.state).toBe('connecting');
    expect(body.pendingAuthorizeUrl).toBeTruthy();

    // Complete the flow, then further connects are a conflict.
    const url = new URL(body.pendingAuthorizeUrl!);
    const cb = await app.request(
      `/api/upwork/callback?code=${fake.issueCode()}&state=${url.searchParams.get('state')}&iss=${fake.issuer}`,
    );
    expect(cb.status).toBe(302);

    const conflict = await app.request('/api/upwork/connect', { method: 'POST', headers: { cookie } });
    expect(conflict.status).toBe(409);
    const err = (await conflict.json()) as { error: { code: string } };
    expect(err.error.code).toBe('conflict');
  });

  it('callback is public (no session cookie needed)', async () => {
    h = await buildHarness();
    const { fake, service, app } = h;
    const cookie = await login(app);
    const connectRes = await app.request('/api/upwork/connect', { method: 'POST', headers: { cookie } });
    const body = (await connectRes.json()) as { authorizeUrl: string };
    const url = new URL(body.authorizeUrl);

    // Deliberately no cookie header: the browser lands here from Upwork.
    const cb = await app.request(
      `/api/upwork/callback?code=${fake.issueCode()}&state=${url.searchParams.get('state')}&iss=${fake.issuer}`,
    );
    expect(cb.status).toBe(302);
    expect(service.status().state).toBe('connected');
  });
});

describe('upwork log redaction', () => {
  let h: Harness | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (!h) return;
    h.service.stop();
    await h.service.dispose().catch(() => undefined);
    await h.fake.close();
    h.db.close();
    h = null;
  });

  it('never logs tokens, refresh tokens, verifiers, or callback query strings', async () => {
    const logLines: string[] = [];
    const consoleLines: string[] = [];
    const push = (...args: unknown[]): void => {
      consoleLines.push(args.map(String).join(' '));
    };
    vi.spyOn(console, 'log').mockImplementation(push);
    vi.spyOn(console, 'warn').mockImplementation(push);
    vi.spyOn(console, 'error').mockImplementation(push);

    h = await buildHarness({ logLines });
    const { fake, app, service } = h;
    const cookie = await login(app);
    await completeConnect(h, cookie);

    // Also exercise the 401 → failed refresh → needs_reauth path (SDK warns here).
    fake.invalidateAccessTokens();
    fake.failRefresh = true;
    await service.ping();

    const secrets = [
      ...fake.issuedAccessTokens,
      ...fake.issuedRefreshTokens,
      fake.lastMcpBearer ?? '',
    ].filter(Boolean);
    const row = new UpworkConnectionStore(h.db).get();
    const verifierBlob = row.verifierEnc ?? '';
    const all = [...logLines, ...consoleLines].join('\n');
    for (const s of [...secrets, verifierBlob]) {
      expect(all).not.toContain(s);
    }
    expect(all).not.toContain('code=');
  });
});
