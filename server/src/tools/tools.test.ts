import { afterEach, describe, expect, it } from 'vitest';
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
import { startFakeUpwork, type FakeMcpTool, type FakeUpwork } from '../upwork/fake-upwork.js';
import { UpworkConnectionService } from '../upwork/service.js';
import { ToolService } from './service.js';
import { ToolCallLog } from './store.js';

const SECRET = 'test-app-secret-012345678901234567890123456789';
const PASSWORD = 'test-password-12345';
const REDIRECT_URI = 'http://127.0.0.1:1/api/upwork/callback';

const FIND_JOBS_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['search'] },
    q: { type: 'string' },
    org_uid: { type: 'number' },
  },
  required: ['action'],
};

const TOOLS: FakeMcpTool[] = [
  { name: 'upwork__ping', description: 'Pings the server', inputSchema: { type: 'object' } },
  { name: 'upwork__find_jobs', description: 'Finds jobs', inputSchema: FIND_JOBS_SCHEMA },
  { name: 'upwork__slow', inputSchema: { type: 'object' } },
  { name: 'upwork__rate_limited_tool', inputSchema: { type: 'object' } },
  { name: 'upwork__boom', inputSchema: { type: 'object' } },
  { name: 'upwork__flaky', inputSchema: { type: 'object' } },
];

interface ToolsHarness {
  fake: FakeUpwork;
  db: Db;
  config: AppConfig;
  service: UpworkConnectionService;
  tools: ToolService;
  toolLog: ToolCallLog;
  app: ReturnType<typeof createApp>;
  logLines: string[];
}

async function buildToolsHarness(opts: {
  callTimeoutMs?: number;
  toolsCacheTtlMs?: number;
} = {}): Promise<ToolsHarness> {
  const fake = await startFakeUpwork({ tools: TOOLS });
  const dir = mkdtempSync(path.join(tmpdir(), 'tools-test-'));
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
  const logLines: string[] = [];
  const service = new UpworkConnectionService({
    db,
    config,
    redirectUri: REDIRECT_URI,
    intervalMs: 5000,
    log: (m) => logLines.push(m),
  });
  const toolLog = new ToolCallLog(db);
  const tools = new ToolService({
    connection: service,
    log: toolLog,
    config,
    callTimeoutMs: opts.callTimeoutMs,
    toolsCacheTtlMs: opts.toolsCacheTtlMs,
    logLine: (m) => logLines.push(m),
  });
  const app = createApp({
    config,
    auth,
    sessions,
    loginLimiter: new RateLimiter(15 * 60 * 1000, 10000),
    upwork: service,
    tools,
    toolLog,
  });
  return { fake, db, config, service, tools, toolLog, app, logLines };
}

async function login(app: ToolsHarness['app']): Promise<string> {
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

async function completeConnect(h: ToolsHarness, cookie: string): Promise<void> {
  const res = await h.app.request('/api/upwork/connect', { method: 'POST', headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { authorizeUrl: string };
  const url = new URL(body.authorizeUrl);
  const code = h.fake.issueCode();
  const state = url.searchParams.get('state') ?? '';
  const cb = await h.app.request(
    `/api/upwork/callback?code=${code}&state=${encodeURIComponent(state)}&iss=${h.fake.issuer}`,
  );
  expect(cb.status).toBe(302);
  expect(h.service.status().state).toBe('connected');
}

describe('tools proxy (plan 04)', () => {
  let h: ToolsHarness | null = null;

  afterEach(async () => {
    if (!h) return;
    h.service.stop();
    await h.service.dispose().catch(() => undefined);
    await h.fake.close();
    h.db.close();
    h = null;
  });

  it('answers 409 before any connection (list + call)', async () => {
    h = await buildToolsHarness();
    const cookie = await login(h.app);
    const list = await h.app.request('/api/tools', { headers: { cookie } });
    expect(list.status).toBe(409);
    const call = await h.app.request('/api/tools/upwork__ping/call', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ args: {} }),
    });
    expect(call.status).toBe(409);
  });

  it('lists tools after connect; cache is TTL-served; ?refresh=1 refetches', async () => {
    h = await buildToolsHarness();
    const cookie = await login(h.app);
    await completeConnect(h, cookie);

    const list = await h.app.request('/api/tools', { headers: { cookie } });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { tools: Array<{ name: string }>; count: number; fetchedAt: string };
    expect(body.count).toBe(TOOLS.length);
    expect(body.tools.map((t) => t.name)).toEqual(expect.arrayContaining(TOOLS.map((t) => t.name)));
    expect(new Date(body.fetchedAt).toISOString()).toBe(body.fetchedAt);
    const listCalls = h.fake.mcpStats.toolsList;
    expect(listCalls).toBe(1);

    const cached = await h.app.request('/api/tools', { headers: { cookie } });
    expect(cached.status).toBe(200);
    const cachedBody = (await cached.json()) as { fetchedAt: string };
    expect(cachedBody.fetchedAt).toBe(body.fetchedAt);
    expect(h.fake.mcpStats.toolsList).toBe(listCalls); // served from cache

    const refresh = await h.app.request('/api/tools?refresh=1', { headers: { cookie } });
    expect(refresh.status).toBe(200);
    expect(h.fake.mcpStats.toolsList).toBe(listCalls + 1);
  });

  it('calls a tool and returns its content (args pass through)', async () => {
    h = await buildToolsHarness();
    const cookie = await login(h.app);
    await completeConnect(h, cookie);

    const res = await h.app.request('/api/tools/upwork__find_jobs/call', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ args: { action: 'search', q: 'node.js' } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: Array<{ type: string; text: string }>; isError: boolean; ms: number };
    expect(body.isError).toBe(false);
    expect(body.content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(body.ms).toBeGreaterThanOrEqual(0);
    expect(h.fake.lastToolCalls.at(-1)).toMatchObject({ name: 'upwork__find_jobs', arguments: { action: 'search', q: 'node.js' } });
  });

  it('treats a tool-level isError result as 200 (MCP semantics)', async () => {
    h = await buildToolsHarness();
    const cookie = await login(h.app);
    await completeConnect(h, cookie);
    h.fake.addTool({
      name: 'upwork__failing',
      behavior: { kind: 'ok', content: [{ type: 'text', text: 'tool says no' }], isError: true },
    });

    const res = await h.app.request('/api/tools/upwork__failing/call', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ args: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isError: boolean };
    expect(body.isError).toBe(true);
  });

  it('validates args against inputSchema (400 on mismatch, not an upstream call)', async () => {
    h = await buildToolsHarness();
    const cookie = await login(h.app);
    await completeConnect(h, cookie);

    const before = h.fake.mcpStats.toolsCall;

    const missing = await h.app.request('/api/tools/upwork__find_jobs/call', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ args: {} }),
    });
    expect(missing.status).toBe(400);
    const missingBody = (await missing.json()) as { error: { code: string; message: string } };
    expect(missingBody.error.code).toBe('bad_request');
    expect(missingBody.error.message).toContain('inputSchema');

    const badEnum = await h.app.request('/api/tools/upwork__find_jobs/call', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ args: { action: 'yell' } }),
    });
    expect(badEnum.status).toBe(400);

    const argsArray = await h.app.request('/api/tools/upwork__ping/call', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ args: ['nope'] }),
    });
    expect(argsArray.status).toBe(400);

    const notJson = await h.app.request('/api/tools/upwork__ping/call', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: '{broken',
    });
    expect(notJson.status).toBe(400);

    expect(h.fake.mcpStats.toolsCall).toBe(before); // nothing reached the fake
  });

  it('answers 404 for an unknown tool (no upstream call)', async () => {
    h = await buildToolsHarness();
    const cookie = await login(h.app);
    await completeConnect(h, cookie);
    const before = h.fake.mcpStats.toolsCall;

    const res = await h.app.request('/api/tools/upwork__does_not_exist/call', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ args: {} }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
    expect(h.fake.mcpStats.toolsCall).toBe(before);
  });

  it('maps upstream 429 to 429 with retry-after', async () => {
    h = await buildToolsHarness();
    const cookie = await login(h.app);
    await completeConnect(h, cookie);
    h.fake.setToolBehavior('upwork__rate_limited_tool', { kind: 'http', status: 429, retryAfterSec: 12 });

    const res = await h.app.request('/api/tools/upwork__rate_limited_tool/call', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ args: {} }),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('12');
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('rate_limited');
  });

  it('maps upstream 5xx to 502 without echoing upstream text', async () => {
    h = await buildToolsHarness();
    const cookie = await login(h.app);
    await completeConnect(h, cookie);
    h.fake.setToolBehavior('upwork__boom', { kind: 'http', status: 500 });

    const res = await h.app.request('/api/tools/upwork__boom/call', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ args: {} }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('upstream_error');
    expect(body.error.message).not.toContain('upstream failure');
  });

  it('maps upstream RPC errors to 502', async () => {
    h = await buildToolsHarness();
    const cookie = await login(h.app);
    await completeConnect(h, cookie);
    h.fake.setToolBehavior('upwork__flaky', { kind: 'rpc_error', code: -32603, message: 'internal' });

    const res = await h.app.request('/api/tools/upwork__flaky/call', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ args: {} }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('upstream_error');
  });

  it('times out a slow tool (504) with the configured per-call timeout', async () => {
    h = await buildToolsHarness({ callTimeoutMs: 300 });
    const cookie = await login(h.app);
    await completeConnect(h, cookie);
    h.fake.setToolBehavior('upwork__slow', { kind: 'ok', delayMs: 2000 });

    const res = await h.app.request('/api/tools/upwork__slow/call', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ args: {} }),
    });
    expect(res.status).toBe(504);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('gateway_timeout');
  });

  it('maps a dead upstream auth to 401 and flips the connection to needs_reauth', async () => {
    h = await buildToolsHarness();
    const cookie = await login(h.app);
    await completeConnect(h, cookie);
    h.fake.invalidateAccessTokens();
    h.fake.failRefresh = true;

    const res = await h.app.request('/api/tools/upwork__ping/call', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ args: {} }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
    expect(h.service.status().state).toBe('needs_reauth');
  });

  it('single-flights concurrent identical calls (one upstream call)', async () => {
    h = await buildToolsHarness();
    const cookie = await login(h.app);
    await completeConnect(h, cookie);
    const before = h.fake.mcpStats.toolsCall;

    const [a, b] = await Promise.all([
      h.app.request('/api/tools/upwork__find_jobs/call', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ args: { action: 'search', q: 'dup' } }),
      }),
      h.app.request('/api/tools/upwork__find_jobs/call', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ args: { action: 'search', q: 'dup' } }),
      }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(h.fake.mcpStats.toolsCall).toBe(before + 1);
  });

  it('logs every call with the args hash only (PII never stored)', async () => {
    h = await buildToolsHarness();
    const cookie = await login(h.app);
    await completeConnect(h, cookie);

    const secret = 'pii-secret@example.com';
    const res = await h.app.request('/api/tools/upwork__find_jobs/call', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ args: { action: 'search', q: secret } }),
    });
    expect(res.status).toBe(200);

    const rows = h.db.prepare('SELECT * FROM tool_calls').all() as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    const blob = JSON.stringify(rows) + JSON.stringify(h.logLines);
    expect(blob).not.toContain(secret);
    expect(blob).not.toContain('pii-secret');

    // And the args hash is stable for identical args.
    const ok = await h.app.request('/api/tools/upwork__find_jobs/call', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ args: { action: 'search', q: 'same' } }),
    });
    expect(ok.status).toBe(200);
    await h.app.request('/api/tools/upwork__find_jobs/call', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ args: { q: 'same', action: 'search' } }), // key order differs
    });
    const hashes = h.db.prepare('SELECT args_hash FROM tool_calls WHERE tool = ?').all('upwork__find_jobs') as Array<{ args_hash: string }>;
    expect(new Set(hashes.map((r) => r.args_hash)).size).toBe(2); // 'same' x2 collapse, secret x1
  });

  it('serves the call log paginated, newest first, without raw args', async () => {
    h = await buildToolsHarness();
    const cookie = await login(h.app);
    await completeConnect(h, cookie);

    for (let i = 0; i < 3; i += 1) {
      const r = await h.app.request('/api/tools/upwork__ping/call', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ args: { i } }),
      });
      expect(r.status).toBe(200);
    }

    const first = await h.app.request('/api/tools/calls?limit=2', { headers: { cookie } });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      items: Array<{ tool: string; statusCode: number; argsHash: string }>;
      hasMore: boolean;
      limit: number;
    };
    expect(firstBody.limit).toBe(2);
    expect(firstBody.items.length).toBe(2);
    expect(firstBody.hasMore).toBe(true);
    expect(firstBody.items.map((i) => i.tool)).toEqual(['upwork__ping', 'upwork__ping']);
    expect(firstBody.items.every((i) => typeof i.argsHash === 'string' && i.argsHash.length === 64)).toBe(true);

    const second = await h.app.request('/api/tools/calls?limit=2&offset=2', { headers: { cookie } });
    const secondBody = (await second.json()) as { items: Array<unknown>; hasMore: boolean };
    expect(secondBody.items.length).toBe(1);
    expect(secondBody.hasMore).toBe(false);
  });

  it('requires a session (401) and answers 405 for wrong methods', async () => {
    h = await buildToolsHarness();
    const noAuth = await h.app.request('/api/tools');
    expect(noAuth.status).toBe(401);

    const cookie = await login(h.app);
    const wrongMethod = await h.app.request('/api/tools', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(wrongMethod.status).toBe(405);
    const body = (await wrongMethod.json()) as { error: { code: string } };
    expect(body.error.code).toBe('method_not_allowed');

    const unknownPath = await h.app.request('/api/tools/nope/calls', { headers: { cookie } });
    expect(unknownPath.status).toBe(404);
  });
});
