#!/usr/bin/env node
/**
 * Browser verification for the plan 06 pages (Dashboard + Find jobs + Job
 * detail) in a REAL connected state.
 *
 * A real Upwork OAuth round-trip cannot run here (no credentials), so this
 * script serves the built SPA from a tiny fake "connected" backend that
 * answers the exact `/api` surface the pages consume. That lets us verify,
 * in a real Chromium: the connected dashboard cards, the jobs search/list +
 * pagination affordances, the job detail + apply panel, graceful per-card
 * degradation, and the light/dark + mobile/desktop layouts.
 *
 * Real-data checks against a live Upwork account remain an owner action
 * (see plan 06, D6.4).
 *
 * Usage:
 *   npm run build
 *   CHROME_PATH=/snap/bin/chromium node web/scripts/browser-verify-connected.mjs
 *
 * Screenshots land in $SHOT_DIR (default /tmp/uwu-shots). Exits non-zero on
 * any failed shot/assertion.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? '/snap/bin/chromium';
const OUT = process.env.SHOT_DIR ?? '/tmp/uwu-shots';
const DIST = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist'));

// ---------------------------------------------------------------------------
// Canned "connected" data (deterministic; no PII).
// ---------------------------------------------------------------------------
const ACCOUNT = {
  orgUid: 'org-1',
  name: 'Org One',
  role: 'TALENT',
  roleLabel: 'Freelancer',
  suspended: false,
};
const ACCOUNTS = [
  ACCOUNT,
  { orgUid: 'org-2', name: 'Agency Two', role: 'FL_AGENCY', roleLabel: 'Agency', suspended: false },
];

const JOB_LIST = [
  {
    job_key: '~02jobalpha',
    id: '111',
    title: 'Senior React / TypeScript dashboard',
    url: 'https://www.upwork.com/jobs/~02jobalpha',
    fixed_price: { min: 3000, max: 5000 },
    client: { name: 'Acme Corp', rating: 4.9, num_contracts: 12, location: 'United States' },
    posted_at: '2026-10-10T09:00:00Z',
    skills: ['React', 'TypeScript', 'Vite'],
    applied: false,
  },
  {
    job_key: '~02jobbravo',
    id: '112',
    title: 'Node.js + MCP API integration',
    url: 'https://www.upwork.com/jobs/~02jobbravo',
    hourly_rate: { min: 60, max: 90 },
    client: { name: 'Beta Labs', rating: 4.7, num_contracts: 8, location: 'Canada' },
    posted_at: '2026-10-11T08:00:00Z',
    skills: ['Node.js', 'TypeScript', 'MCP'],
    applied: false,
  },
  {
    job_key: '~02jobcharlie',
    id: '113',
    title: 'Tailwind design system polish',
    url: 'https://www.upwork.com/jobs/~02jobcharlie',
    fixed_price: 800,
    client: { name: 'Gamma Studio', rating: 5.0, num_contracts: 3, location: 'Germany' },
    posted_at: '2026-10-11T06:00:00Z',
    skills: ['Tailwind CSS', 'React'],
    applied: true,
  },
];

const CANONICAL_JOB = {
  job: {
    job_key: '~02jobalpha',
    id: '111',
    title: 'Senior React / TypeScript dashboard',
    url: 'https://www.upwork.com/jobs/~02jobalpha',
    fixed_price: { min: 3000, max: 5000 },
    connects_cost: 10,
    posted_at: '2026-10-10T09:00:00Z',
    client: { name: 'Acme Corp', rating: 4.9, num_contracts: 12, location: 'United States' },
    description:
      'We are building a self-hosted freelancer dashboard on top of the Upwork MCP server and ' +
      'need a senior React/TypeScript engineer to help ship it.\n\nSmall, well-scoped codebase.',
    requirements: [
      'Ship clean, tested code',
      'Familiarity with MCP or a similar tool protocol',
      'Experience with Tailwind CSS',
    ],
    skills: ['React', 'TypeScript', 'Vite', 'Tailwind CSS'],
    applied: false,
  },
};

/** When true, `upwork__list_offers` reports an error (per-card degradation check). */
let failOffers = false;

const TOOLS = [
  'upwork__find_jobs',
  'upwork__list_freelancer_proposals',
  'upwork__list_offers',
  'upwork__get_messages',
  'upwork__get_profile',
].map((name) => ({ name, description: `Fake ${name}`, inputSchema: { type: 'object' } }));

function findJobs(args) {
  const action = args?.action;
  if (action === 'get') return { isError: false, ms: 4, content: [], structuredContent: CANONICAL_JOB };
  return { isError: false, ms: 6, content: [], structuredContent: { jobs: JOB_LIST, total: JOB_LIST.length } };
}

function toolCall(tool, args) {
  switch (tool) {
    case 'upwork__find_jobs':
      return findJobs(args);
    case 'upwork__list_freelancer_proposals':
      return {
        isError: false,
        ms: 5,
        content: [],
        structuredContent: {
          invitations: [
            { id: 'inv-1', title: 'Build our marketing site', client_name: 'Acme Corp' },
            { id: 'inv-2', title: 'Dashboard MVP', client_name: 'Beta Labs' },
          ],
        },
      };
    case 'upwork__list_offers':
      if (failOffers) {
        return {
          isError: true,
          ms: 7,
          content: [{ type: 'text', text: 'Upstream hiccup (fake offers failure)' }],
        };
      }
      return {
        isError: false,
        ms: 5,
        content: [],
        structuredContent: {
          offers: [{ id: 'off-1', title: 'Senior frontend — 6 months', client_name: 'Gamma Studio' }],
        },
      };
    case 'upwork__get_messages':
      return {
        isError: false,
        ms: 5,
        content: [],
        structuredContent: {
          rooms: [
            { id: 'room-1', title: 'Acme Corp — Dashboard', subject: 'Scope + timeline' },
            { id: 'room-2', title: 'Beta Labs — API', subject: 'API keys' },
          ],
        },
      };
    case 'upwork__get_profile':
      return { isError: false, ms: 3, content: [], structuredContent: { balance: 12 } };
    default:
      return { isError: false, ms: 2, content: [], structuredContent: {} };
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function handleApi(req, res, url) {
  const p = url.pathname;
  const json = (body, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) =>
    new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => resolve(data));
    });

  if (p === '/api/setup' && req.method === 'GET') return json({ required: false });
  if (p === '/api/me' && req.method === 'GET')
    return json({ authenticated: true, owner: true, userId: 1 });
  if (p === '/api/upwork/status' && req.method === 'GET')
    return json({ state: 'connected', accountSummary: 'Org One' });
  if (p === '/api/upwork/account' && req.method === 'GET')
    return json({ account: ACCOUNT, accounts: ACCOUNTS, source: 'stored' });
  if (p === '/api/tools' && req.method === 'GET')
    return json({ tools: TOOLS, count: TOOLS.length, fetchedAt: new Date().toISOString() });
  if (p === '/_test/fail-offers' && req.method === 'POST') {
    const raw = await readBody(req);
    let on = false;
    try {
      on = Boolean((JSON.parse(raw) || {}).on);
    } catch {
      /* default off */
    }
    failOffers = on;
    return json({ ok: true });
  }

  const callMatch = p.match(/^\/api\/tools\/([^/]+)\/call$/);
  if (callMatch && req.method === 'POST') {
    const tool = decodeURIComponent(callMatch[1]);
    const raw = await readBody(req);
    let args = {};
    try {
      args = (JSON.parse(raw) || {}).args ?? {};
    } catch {
      /* ignore */
    }
    return json(toolCall(tool, args));
  }

  return json({ error: { code: 'not_found', message: `no fake route for ${p}` } }, 404);
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  let path = url.pathname;
  if (path === '/') path = '/index.html';
  const file = normalize(join(DIST, path));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    const s = await stat(file);
    if (s.isDirectory()) {
      const idx = join(DIST, 'index.html');
      sendFile(idx, res);
      return;
    }
    sendFile(file, res);
  } catch {
    // SPA fallback for client-side routes (/jobs, /jobs/..., etc.)
    sendFile(join(DIST, 'index.html'), res);
  }
}

async function sendFile(file, res) {
  try {
    const buf = await readFile(file);
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_test/')) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'internal', message: String(err) } }));
  }
});

let failures = 0;

function hasText(page, text) {
  return page.waitForFunction(
    (t) => document.body && document.body.innerText.includes(t),
    { timeout: 15_000 },
    text,
  );
}

async function shot(page, name, expectText, dark) {
  if (expectText) {
    try {
      await hasText(page, expectText);
    } catch (err) {
      failures += 1;
      console.error(`FAIL ${name}: missing "${expectText}" — ${err.message}`);
      return;
    }
  }
  if (dark) {
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    if (!isDark) {
      failures += 1;
      console.error(`FAIL ${name}: dark theme class not applied`);
      return;
    }
  }
  await new Promise((r) => setTimeout(r, 350)); // let layout + fonts settle
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file });
  console.log(`OK   ${name}`);
}

function trackPageErrors(page, label) {
  page.on('pageerror', (err) => {
    failures += 1;
    console.error(`FAIL ${label}: uncaught page error — ${err.message}`);
  });
}


async function run() {
  await new Promise((r) => {
    server.listen(0, '127.0.0.1', () => r(undefined));
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
    ],
  });

  try {
    const ctx = await browser.defaultBrowserContext();

    // Desktop.
    {
      const page = await ctx.newPage();
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
      trackPageErrors(page, 'desktop');

      await page.goto(`${base}/`, { waitUntil: 'networkidle0' });
      await shot(page, 'p06-dashboard-desktop-light', '12 Connects');

      // All five dashboard cards must have rendered.
      const cardTitles = await page.evaluate(
        () => Array.from(document.querySelectorAll('main h2, h2')).map((h) => h.textContent),
      );
      for (const t of ['Invitations', 'Open offers', 'Active messages', 'Matched jobs', 'Connects']) {
        if (!cardTitles.includes(t)) {
          failures += 1;
          console.error(`FAIL p06-dashboard-desktop-light: missing card "${t}"`);
        }
      }

      // Per-card degradation: offers fails, the other cards stay healthy.
      await fetch(`${base}/_test/fail-offers`, { method: 'POST', body: JSON.stringify({ on: true }) });
      await page.goto(`${base}/`, { waitUntil: 'networkidle0' });
      await shot(page, 'p06-dashboard-desktop-light-degraded', 'Upstream hiccup (fake offers failure)');
      const degraded = await page.evaluate(() => document.body.innerText);
      if (!degraded.includes('12 Connects') || !degraded.includes('Senior React / TypeScript dashboard')) {
        failures += 1;
        console.error('FAIL p06-dashboard-desktop-light-degraded: sibling cards did not stay healthy');
      }
      await fetch(`${base}/_test/fail-offers`, { method: 'POST', body: JSON.stringify({ on: false }) });

      await page.goto(`${base}/jobs`, { waitUntil: 'networkidle0' });
      await shot(page, 'p06-jobs-desktop-light', 'Senior React / TypeScript dashboard');

      await page.goto(`${base}/jobs/%7E02jobalpha`, { waitUntil: 'networkidle0' });
      await shot(page, 'p06-job-detail-desktop-light', 'Write proposal');
      const detailText = await page.evaluate(() => document.body.innerText);
      if (!detailText.includes('10 Connects')) {
        failures += 1;
        console.error('FAIL p06-job-detail-desktop-light: connects cost not shown');
      }

      await page.goto(`${base}/?theme=dark`, { waitUntil: 'networkidle0' });
      await shot(page, 'p06-dashboard-desktop-dark', '12 Connects', true);

      await page.goto(`${base}/jobs?theme=dark`, { waitUntil: 'networkidle0' });
      await shot(page, 'p06-jobs-desktop-dark', 'Senior React / TypeScript dashboard', true);

      await page.goto(`${base}/jobs/%7E02jobalpha?theme=dark`, { waitUntil: 'networkidle0' });
      await shot(page, 'p06-job-detail-desktop-dark', 'Write proposal', true);

      await page.close();
    }

    // Mobile.
    {
      const page = await ctx.newPage();
      await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 });
      trackPageErrors(page, 'mobile');

      await page.goto(`${base}/`, { waitUntil: 'networkidle0' });
      await shot(page, 'p06-dashboard-mobile-light', '12 Connects');

      await page.goto(`${base}/jobs`, { waitUntil: 'networkidle0' });
      await shot(page, 'p06-jobs-mobile-light', 'Senior React / TypeScript dashboard');

      await page.goto(`${base}/jobs/%7E02jobalpha`, { waitUntil: 'networkidle0' });
      await shot(page, 'p06-job-detail-mobile-light', 'Write proposal');

      await page.goto(`${base}/?theme=dark`, { waitUntil: 'networkidle0' });
      await shot(page, 'p06-dashboard-mobile-dark', '12 Connects', true);

      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((r) => server.close(() => r(undefined)));
  }
}

await import('node:fs/promises').then((m) => m.mkdir(OUT, { recursive: true }));
try {
  await run();
} catch (err) {
  failures += 1;
  console.error(`ERROR ${err?.message ?? err}`);
}
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log(`All connected-state screenshots written to ${OUT}`);
