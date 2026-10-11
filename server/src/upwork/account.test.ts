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
import { startFakeUpwork, type FakeMcpTool, type FakeUpwork } from './fake-upwork.js';
import { parseUpworkAccounts, pickAccount, UpworkAccountService, type UpworkAccount } from './account.js';
import { UpworkConnectionService } from './service.js';

const SECRET = 'test-app-secret-012345678901234567890123456789';
const PASSWORD = 'test-password-12345';
const REDIRECT_URI = 'http://127.0.0.1:1/api/upwork/callback';

const ACCOUNTS = [
  { org_uid: 'org-client', name: 'Acme Co', role: 'CLIENT', role_label: 'Client', suspended: false },
  { org_uid: 'org-talent', name: 'My Freelance Org', role: 'TALENT', role_label: 'Freelancer', suspended: false },
  { org_uid: 'org-talent-2', name: 'Suspended Org', role: 'TALENT', role_label: 'Freelancer', suspended: true },
];

function accountsTool(): FakeMcpTool {
  return {
    name: 'upwork__list_accounts',
    inputSchema: { type: 'object' },
    behavior: { kind: 'ok', content: [{ type: 'text', text: JSON.stringify({ accounts: ACCOUNTS }) }] },
  };
}

interface Harness {
  fake: FakeUpwork;
  db: Db;
  config: AppConfig;
  service: UpworkConnectionService;
  accounts: UpworkAccountService;
  app: ReturnType<typeof createApp>;
}

async function buildHarness(): Promise<Harness> {
  const fake = await startFakeUpwork({ tools: [accountsTool()] });
  const dir = mkdtempSync(path.join(tmpdir(), 'upwork-account-test-'));
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
  const service = new UpworkConnectionService({
    db,
    config,
    redirectUri: REDIRECT_URI,
    intervalMs: 50,
  });
  const accounts = new UpworkAccountService({ connection: service, db });
  const app = createApp({
    config,
    auth,
    sessions,
    loginLimiter: new RateLimiter(15 * 60 * 1000, 10000),
    upwork: service,
    upworkAccount: accounts,
  });
  return { fake, db, config, service, accounts, app };
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

async function completeConnect(h: Harness, cookie: string): Promise<void> {
  const res = await h.app.request('/api/upwork/connect', { method: 'POST', headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { authorizeUrl: string };
  const url = new URL(body.authorizeUrl);
  const code = h.fake.issueCode();
  const state = url.searchParams.get('state') ?? '';
  expect(state).toBeTruthy();
  const cb = await h.app.request(
    `/api/upwork/callback?code=${code}&state=${encodeURIComponent(state)}&iss=${h.fake.issuer}`,
  );
  expect(cb.status).toBe(302);
}

interface AccountBody {
  account: { orgUid: string; name: string; role: string; roleLabel: string; suspended: boolean } | null;
  accounts: unknown[];
  source: 'stored' | 'bootstrapped' | 'none';
}

describe('upwork account selection (plan 06)', () => {
  let h: Harness | null = null;

  afterEach(async () => {
    if (!h) return;
    h.service.stop();
    await h.service.dispose().catch(() => undefined);
    await h.fake.close();
    h.db.close();
    h = null;
  });

  it('requires authentication', async () => {
    h = await buildHarness();
    const res = await h.app.request('/api/upwork/account');
    expect(res.status).toBe(401);
  });

  it('answers account:null before a connection exists', async () => {
    h = await buildHarness();
    const cookie = await login(h.app);
    const res = await h.app.request('/api/upwork/account', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ account: null, accounts: [], source: 'none' });
  });

  it('refuses PUT while disconnected with the standard 409', async () => {
    h = await buildHarness();
    const cookie = await login(h.app);
    const res = await h.app.request('/api/upwork/account', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ orgUid: 'org-talent' }),
    });
    expect(res.status).toBe(409);
  });

  it('bootstraps the TALENT account once, then serves the stored selection', async () => {
    h = await buildHarness();
    const cookie = await login(h.app);
    await completeConnect(h, cookie);

    const first = await h.app.request('/api/upwork/account', { headers: { cookie } });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as AccountBody;
    expect(firstBody.source).toBe('bootstrapped');
    expect(firstBody.account).toMatchObject({
      orgUid: 'org-talent',
      name: 'My Freelance Org',
      role: 'TALENT',
      suspended: false,
    });
    expect(firstBody.accounts).toHaveLength(3);

    const callsBefore = h.fake.mcpStats.toolsCall;
    const second = await h.app.request('/api/upwork/account', { headers: { cookie } });
    const secondBody = (await second.json()) as AccountBody;
    expect(secondBody.source).toBe('stored');
    expect(secondBody.account?.orgUid).toBe('org-talent');
    expect(h.fake.mcpStats.toolsCall).toBe(callsBefore);

    const refreshed = await h.app.request('/api/upwork/account?refresh=1', {
      headers: { cookie },
    });
    const refreshedBody = (await refreshed.json()) as AccountBody;
    expect(refreshedBody.source).toBe('bootstrapped');
    expect(h.fake.mcpStats.toolsCall).toBe(callsBefore + 1);
  });

  it('PUT selects another account (validated upstream); unknown orgUid is 400', async () => {
    h = await buildHarness();
    const cookie = await login(h.app);
    await completeConnect(h, cookie);

    const ok = await h.app.request('/api/upwork/account', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ orgUid: 'org-client' }),
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { account: { orgUid: string } }).account.orgUid).toBe('org-client');

    const stored = (await (
      await h.app.request('/api/upwork/account', { headers: { cookie } })
    ).json()) as AccountBody;
    expect(stored.source).toBe('stored');
    expect(stored.account?.orgUid).toBe('org-client');

    const unknown = await h.app.request('/api/upwork/account', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ orgUid: 'org-nope' }),
    });
    expect(unknown.status).toBe(400);

    const missing = await h.app.request('/api/upwork/account', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(missing.status).toBe(400);
  });

  it('disconnect clears the stored selection', async () => {
    h = await buildHarness();
    const cookie = await login(h.app);
    await completeConnect(h, cookie);
    const bootstrapped = (await (
      await h.app.request('/api/upwork/account', { headers: { cookie } })
    ).json()) as AccountBody;
    expect(bootstrapped.account?.orgUid).toBe('org-talent');

    const off = await h.app.request('/api/upwork/disconnect', {
      method: 'POST',
      headers: { cookie },
    });
    expect(off.status).toBe(200);

    const after = (await (
      await h.app.request('/api/upwork/account', { headers: { cookie } })
    ).json()) as AccountBody;
    expect(after.source).toBe('none');
    expect(after.account).toBeNull();
  });
});

describe('pickAccount (plan 06)', () => {
  const a = (over: Partial<UpworkAccount>): UpworkAccount => ({
    orgUid: 'x',
    name: 'n',
    role: '',
    roleLabel: '',
    suspended: false,
    ...over,
  });

  it('prefers a non-suspended TALENT, then FL_AGENCY, then anyone', () => {
    const accounts = [a({ orgUid: 'c', role: 'CLIENT' }), a({ orgUid: 't', role: 'TALENT' })];
    expect(pickAccount(accounts)?.orgUid).toBe('t');
    const agency = [a({ orgUid: 'c', role: 'CLIENT' }), a({ orgUid: 'ag', role: 'FL_AGENCY' })];
    expect(pickAccount(agency)?.orgUid).toBe('ag');
    const clients = [a({ orgUid: 'c1', role: 'CLIENT' }), a({ orgUid: 'c2', role: 'CLIENT' })];
    expect(pickAccount(clients)?.orgUid).toBe('c1');
    expect(pickAccount([])).toBeNull();
  });

  it('skips suspended accounts but falls back to the full list when all are suspended', () => {
    const suspendedTalent = a({ orgUid: 't1', role: 'TALENT', suspended: true });
    const liveTalent = a({ orgUid: 't2', role: 'TALENT' });
    expect(pickAccount([suspendedTalent, liveTalent])?.orgUid).toBe('t2');
    const allSuspended = [a({ orgUid: 'c', role: 'CLIENT', suspended: true })];
    expect(pickAccount(allSuspended)?.orgUid).toBe('c');
  });
});

describe('parseUpworkAccounts (plan 06)', () => {
  it('parses a text JSON payload wrapped in an accounts key', () => {
    const out = parseUpworkAccounts({
      content: [{ type: 'text', text: JSON.stringify({ accounts: ACCOUNTS }) }],
    });
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      orgUid: 'org-client',
      name: 'Acme Co',
      role: 'CLIENT',
      roleLabel: 'Client',
      suspended: false,
    });
  });

  it('parses structuredContent and top-level arrays, skipping items without org_uid', () => {
    const out = parseUpworkAccounts({
      content: [],
      structuredContent: [
        { org_uid: 'a', name: 'A' },
        { name: 'no uid — skipped' },
        'junk',
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.orgUid).toBe('a');
  });

  it('accepts camelCase fields and returns [] for garbage', () => {
    const camel = parseUpworkAccounts({
      content: [{ type: 'text', text: JSON.stringify([{ orgUid: 'u1', roleLabel: 'Freelancer' }]) }],
    });
    expect(camel).toHaveLength(1);
    expect(camel[0]?.orgUid).toBe('u1');
    expect(camel[0]?.roleLabel).toBe('Freelancer');
    const garbage = parseUpworkAccounts({
      content: [{ type: 'text', text: 'no json here' }],
    });
    expect(garbage).toEqual([]);
  });
});
