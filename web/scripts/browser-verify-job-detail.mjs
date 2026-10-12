#!/usr/bin/env node
/**
 * Browser verification for the Job detail recovery states (plan 10):
 *  1. happy-path detail (regression),
 *  2. placeholder key (`row-N`, search row without a recognizable reference):
 *     no `get` call, "Open this job" card, paste-a-reference loads the job,
 *  3. tool error ("id is required (trace_id: …)"): verbatim error +
 *     "Try another job reference" card, paste loads the job.
 *
 * A real Upwork OAuth round-trip cannot run here (no credentials), so this
 * script serves the built SPA from a tiny fake "connected" backend (same
 * pattern as `browser-verify-connected.mjs`) and drives the system Chromium
 * via puppeteer-core (no browser download).
 *
 * Usage:
 *   npm run build
 *   CHROME_PATH=/snap/bin/chromium node web/scripts/browser-verify-job-detail.mjs
 *
 * Screenshots land in $SHOT_DIR (default /tmp/uwu-shots). Exits non-zero on
 * any failed shot/assertion.
 */
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? '/snap/bin/chromium';
const OUT = process.env.SHOT_DIR ?? '/tmp/uwu-shots';
const DIST = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist'));

const JOB_ERROR_TEXT = 'id is required (trace_id: 9db0f5ec6f565232368425a55c74b05b)';
/** `get` with this id answers the Upwork-style tool error (state 3). */
const FAIL_GET_FOR = '~02jobbravo';

const ACCOUNT = {
  orgUid: 'org-1',
  name: 'Org One',
  role: 'TALENT',
  roleLabel: 'Freelancer',
  suspended: false,
};

const JOB_LIST = [
  {
    job_key: '~02jobalpha',
    id: '111',
    title: 'Senior React / TypeScript dashboard',
    url: 'https://www.upwork.com/jobs/~02jobalpha',
    fixed_price: { min: 3000, max: 5000 },
  },
  {
    job_key: '~02jobbravo',
    id: '112',
    title: 'Node.js + MCP API integration',
    url: 'https://www.upwork.com/jobs/~02jobbravo',
    hourly_rate: { min: 60, max: 90 },
  },
  // No job_key / id / url anywhere: the row maps to the `row-2` placeholder
  // key (state 2).
  {
    title: 'Referenceless mystery job',
    budget: 500,
  },
];

const CANONICAL_JOB = {
  job: {
    id: '111',
    job_key: '~02jobalpha',
    title: 'Senior React / TypeScript dashboard',
    url: 'https://www.upwork.com/jobs/~02jobalpha',
    fixed_price: { min: 3000, max: 5000 },
    connects_cost: 10,
    posted_at: '2026-10-10T09:00:00Z',
    client: { name: 'Acme Corp', rating: 4.9 },
    description: 'We need a senior React/TypeScript engineer.',
    applied: false,
  },
};

const TOOLS = ['upwork__find_jobs', 'upwork__get_profile'].map((name) => ({
  name,
  description: `Fake ${name}`,
  inputSchema: { type: 'object' },
}));

function findJobs(args) {
  if (args?.action === 'get') {
    if (args.id === FAIL_GET_FOR) {
      return { isError: true, ms: 8, content: [{ type: 'text', text: JOB_ERROR_TEXT }] };
    }
    return { isError: false, ms: 4, content: [], structuredContent: CANONICAL_JOB };
  }
  return { isError: false, ms: 6, content: [], structuredContent: { jobs: JOB_LIST, total: JOB_LIST.length } };
}

function toolCall(tool, args) {
  if (tool === 'upwork__find_jobs') return findJobs(args);
  if (tool === 'upwork__get_profile') {
    return { isError: false, ms: 3, content: [], structuredContent: { balance: 12 } };
  }
  return { isError: false, ms: 2, content: [], structuredContent: {} };
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
    return json({ account: ACCOUNT, accounts: [ACCOUNT], source: 'stored' });
  if (p === '/api/tools' && req.method === 'GET')
    return json({ tools: TOOLS, count: TOOLS.length, fetchedAt: new Date().toISOString() });

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
      await sendFile(join(DIST, 'index.html'), res);
      return;
    }
    await sendFile(file, res);
  } catch {
    // SPA fallback for client-side routes (/jobs, /jobs/..., etc.)
    await sendFile(join(DIST, 'index.html'), res);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
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
    (t) => document.body && document.body.innerText.toLowerCase().includes(t.toLowerCase()),
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

/** Set a React-controlled input value and fire the input event. */
async function typeRecovery(page, value) {
  await page.evaluate((v) => {
    const input = document.querySelector(
      'input[aria-label="Job URL, numeric job id, or ciphertext"]',
    );
    if (!input) throw new Error('recovery input not found');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function clickLoadJob(page) {
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent.trim() === 'Load job',
    );
    if (!btn) throw new Error('Load job button not found');
    btn.click();
  });
}

async function runScenario(page, base, tag, dark) {
  // 1. Happy path (regression guard).
  await page.goto(`${base}/jobs/${encodeURIComponent('~02jobalpha')}${dark ? '?theme=dark' : ''}`, {
    waitUntil: 'networkidle0',
  });
  await shot(page, `p10-job-detail-ok-${tag}`, 'Write proposal', dark);

  // 2. Placeholder row: the referenceless job maps to `row-2`.
  await page.goto(`${base}/jobs/row-2${dark ? '?theme=dark' : ''}`, { waitUntil: 'networkidle0' });
  await shot(page, `p10-job-detail-placeholder-${tag}`, 'Open this job', dark);
  await typeRecovery(page, 'https://www.upwork.com/jobs/~02jobalpha');
  await clickLoadJob(page);
  await shot(page, `p10-job-detail-placeholder-loaded-${tag}`, 'Write proposal', dark);

  // 3. Tool error: `get` for ~02jobbravo fails with the Upwork text.
  await page.goto(`${base}/jobs/${encodeURIComponent(FAIL_GET_FOR)}${dark ? '?theme=dark' : ''}`, {
    waitUntil: 'networkidle0',
  });
  await shot(page, `p10-job-detail-error-${tag}`, 'Try another job reference', dark);
  const errText = await page.evaluate(() => document.body.innerText.toLowerCase());
  if (!errText.includes(JOB_ERROR_TEXT.toLowerCase())) {
    failures += 1;
    console.error(`FAIL p10-job-detail-error-${tag}: verbatim tool error not shown`);
  }
  await typeRecovery(page, '111');
  await clickLoadJob(page);
  await shot(page, `p10-job-detail-error-recovered-${tag}`, 'Write proposal', dark);
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

    // The referenceless row must be linked on the jobs page under row-2.
    {
      const page = await ctx.newPage();
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
      trackPageErrors(page, 'jobs');
      await page.goto(`${base}/jobs`, { waitUntil: 'networkidle0' });
      const href = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href^="/jobs/row-"]')).map((a) => a.getAttribute('href')),
      );
      if (!href.includes('/jobs/row-2')) {
        failures += 1;
        console.error('FAIL jobs page: referenceless row not linked under row-2');
      } else {
        console.log('OK   jobs page links the referenceless row under row-2');
      }
      await page.close();
    }

    const desktop = await ctx.newPage();
    await desktop.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    trackPageErrors(desktop, 'desktop');
    await runScenario(desktop, base, 'desktop-light', false);

    const desktopDark = await ctx.newPage();
    await desktopDark.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    trackPageErrors(desktopDark, 'desktop-dark');
    await runScenario(desktopDark, base, 'desktop-dark', true);

    const mobile = await ctx.newPage();
    await mobile.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 });
    trackPageErrors(mobile, 'mobile');
    await runScenario(mobile, base, 'mobile-light', false);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(() => r(undefined)));
  }
}

await mkdir(OUT, { recursive: true });
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
console.log(`All plan-10 screenshots written to ${OUT}`);
