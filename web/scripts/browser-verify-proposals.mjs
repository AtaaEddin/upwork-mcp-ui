#!/usr/bin/env node
/**
 * Browser verification for plan 07a (Proposals: list/detail +
 * draft → review → confirm-submit) in a REAL connected state.
 *
 * Same approach as browser-verify-connected.mjs (plan 06): the built SPA is
 * served from a fake "connected" backend answering the exact `/api` surface,
 * so a real Chromium drives the full two-step write flow:
 *   /proposals list + status filter + row detail,
 *   /jobs/:jobKey/propose → form → create preview → review (+boost) →
 *   confirm submit → submitted view + toast + list verification,
 *   plus the applied / invited preflight variants.
 *
 * Usage:
 *   npm run build
 *   CHROME_PATH=/snap/bin/chromium node web/scripts/browser-verify-proposals.mjs
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
const ACCOUNTS = [ACCOUNT];

/** Job keys used in the fake world. */
const JOB_ALPHA = '~02jobalpha'; // standard apply target
const JOB_BRAVO = '~02jobbravo'; // reached as an invitation
const JOB_CHARLIE = '~02jobcharlie'; // already applied

const JOBS = {
  [JOB_ALPHA]: {
    job: {
      job_key: JOB_ALPHA,
      id: '111',
      title: 'Senior React / TypeScript dashboard',
      url: 'https://www.upwork.com/jobs/~02jobalpha',
      client_name: 'Acme Corp',
      fixed_price: { min: 3000, max: 5000 },
      connects_cost: 10,
      posted_at: '2026-10-10T09:00:00Z',
      applied: false,
      client_feedback: 'Top client, pays on time',
      screening_questions: ['Why are you a good fit for this role?'],
    },
  },
  [JOB_BRAVO]: {
    job: {
      job_key: JOB_BRAVO,
      id: '112',
      title: 'Node.js + MCP API integration',
      url: 'https://www.upwork.com/jobs/~02jobbravo',
      client_name: 'Beta Labs',
      hourly_rate: { min: 60, max: 90 },
      connects_cost: 10,
      posted_at: '2026-10-11T08:00:00Z',
      applied: false,
      screening_questions: [],
    },
  },
  [JOB_CHARLIE]: {
    job: {
      job_key: JOB_CHARLIE,
      id: '113',
      title: 'Tailwind design system polish',
      url: 'https://www.upwork.com/jobs/~02jobcharlie',
      client_name: 'Gamma Studio',
      fixed_price: 800,
      connects_cost: 8,
      posted_at: '2026-10-11T06:00:00Z',
      applied: true,
      screening_questions: [],
    },
  },
};

const TOOLS = [
  'upwork__find_jobs',
  'upwork__list_freelancer_proposals',
  'upwork__manage_proposals',
  'upwork__confirm_preview',
  'upwork__get_profile',
].map((name) => ({ name, description: `Fake ${name}`, inputSchema: { type: 'object' } }));

const state = { submitted: false };

function findJobs(args) {
  const action = args?.action;
  if (action === 'get') {
    const job = JOBS[args.id]?.job ?? JOBS[JOB_ALPHA].job;
    return { isError: false, ms: 4, content: [], structuredContent: { job } };
  }
  return {
    isError: false,
    ms: 6,
    content: [],
    structuredContent: { jobs: Object.values(JOBS).map((j) => j.job), total: 3 },
  };
}

function listProposals(args) {
  const action = args?.action;
  if (action === 'invitations') {
    return {
      isError: false,
      ms: 4,
      content: [],
      structuredContent: {
        invitations: [
          { invitation_id: 'inv-1', job: { id: '112', job_key: JOB_BRAVO }, title: 'Node.js + MCP API integration' },
        ],
      },
    };
  }
  if (action === 'get') {
    if (args.id === '900') {
      return {
        isError: false,
        ms: 4,
        content: [],
        structuredContent: {
          proposal: {
            id: '900',
            job_key: JOB_ALPHA,
            title: 'Senior React / TypeScript dashboard',
            client_name: 'Acme Corp',
            status: 'Pending',
            status_label: 'Submitted',
            posted_at: '2026-10-11T12:00:00Z',
            terms: { charged_amount: 3000, connects_bid: 5 },
            cover_letter: 'I have shipped exactly this stack.',
          },
        },
      };
    }
    return {
      isError: false,
      ms: 4,
      content: [],
      structuredContent: {
        proposal: {
          id: '801',
          job_key: JOB_BRAVO,
          title: 'Node.js + MCP API integration',
          client_name: 'Beta Labs',
          status: 'Pending',
          status_label: 'Submitted',
          posted_at: '2026-10-09T12:00:00Z',
          terms: { charged_amount: 2500, connects_bid: 3 },
          cover_letter: 'Hi Beta Labs, I have shipped MCP clients end to end.',
          screening_answers: [{ question: 'Experience?', answer: '2 years with MCP clients.' }],
        },
      },
    };
  }
  // action 'list' — the verification call passes status explicitly.
  if (action === 'list' && args.status === 'Pending' && state.submitted) {
    return {
      isError: false,
      ms: 5,
      content: [],
      structuredContent: {
        proposals: [
          {
            id: '900',
            job_key: JOB_ALPHA,
            title: 'Senior React / TypeScript dashboard',
            client_name: 'Acme Corp',
            status: 'Pending',
            status_label: 'Submitted',
            posted_at: '2026-10-11T12:00:00Z',
            terms: { charged_amount: 3000, connects_bid: 5 },
          },
        ],
      },
    };
  }
  const proposals = [
    {
      id: '801',
      job_key: JOB_BRAVO,
      title: 'Node.js + MCP API integration',
      client_name: 'Beta Labs',
      status: 'Pending',
      status_label: 'Submitted',
      posted_at: '2026-10-09T12:00:00Z',
      terms: { charged_amount: 2500 },
    },
  ];
  if (state.submitted) {
    proposals.unshift({
      id: '900',
      job_key: JOB_ALPHA,
      title: 'Senior React / TypeScript dashboard',
      client_name: 'Acme Corp',
      status: 'Pending',
      status_label: 'Submitted',
      posted_at: '2026-10-11T12:00:00Z',
      terms: { charged_amount: 3000, connects_bid: 5 },
    });
  }
  return { isError: false, ms: 5, content: [], structuredContent: { proposals } };
}

function createProposal(args) {
  if (args?.action !== 'create') return { isError: false, ms: 2, content: [], structuredContent: {} };
  return {
    isError: false,
    ms: 8,
    content: [],
    structuredContent: {
      preview_id: 'pv-111',
      type: 'proposal',
      connects_required: 10,
      connects_balance: 12,
      boost: {
        available: true,
        max_connects: 20,
        suggested_bid: 5,
        recommendation: 'consider',
        reason: 'Competing bids are 3–8 Connects.',
      },
    },
  };
}

function confirmPreview(args) {
  if (args?.action !== 'confirm') return { isError: false, ms: 2, content: [], structuredContent: {} };
  state.submitted = true;
  return {
    isError: false,
    ms: 8,
    content: [],
    structuredContent: {
      status: 'submitted',
      proposal: {
        id: '900',
        status: 'Pending',
        status_label: 'Submitted',
        terms: { charged_amount: 3000, connects_bid: Number(args.boost_connects ?? 5) },
      },
    },
  };
}

function getProfile(args) {
  const action = args?.action;
  if (action === 'connects_balance') {
    return { isError: false, ms: 3, content: [], structuredContent: { balance: 12 } };
  }
  if (action === 'list_highlights') {
    return {
      isError: false,
      ms: 3,
      content: [],
      structuredContent: {
        portfolio_projects: [{ id: 'pp-1', title: 'MCP dashboard project' }],
        certificates: [{ id: 'cert-1', title: 'TypeScript Pro' }],
      },
    };
  }
  return { isError: false, ms: 3, content: [], structuredContent: { name: 'Org One' } };
}

function toolCall(tool, args) {
  switch (tool) {
    case 'upwork__find_jobs':
      return findJobs(args);
    case 'upwork__list_freelancer_proposals':
      return listProposals(args);
    case 'upwork__manage_proposals':
      return createProposal(args);
    case 'upwork__confirm_preview':
      return confirmPreview(args);
    case 'upwork__get_profile':
      return getProfile(args);
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
      await sendFile(join(DIST, 'index.html'), res);
      return;
    }
    await sendFile(file, res);
  } catch {
    // SPA fallback for client-side routes (/proposals, /jobs/..., etc.)
    await sendFile(join(DIST, 'index.html'), res);
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

async function shot(page, name, expectText, dark, checkOverflow = false) {
  if (expectText) {
    try {
      await page.waitForFunction(
        (t) => document.body && document.body.innerText.includes(t),
        { timeout: 15_000 },
        expectText,
      );
    } catch (err) {
      failures += 1;
      console.error(`FAIL ${name}: missing "${expectText}" — ${err.message}`);
      return false;
    }
  }
  if (dark) {
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    if (!isDark) {
      failures += 1;
      console.error(`FAIL ${name}: dark theme class not applied`);
      return false;
    }
  }
  if (checkOverflow) {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    if (overflow) {
      failures += 1;
      console.error(`FAIL ${name}: horizontal overflow at mobile width`);
    }
  }
  await new Promise((r) => setTimeout(r, 350));
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file });
  console.log(`OK   ${name}`);
  return true;
}

function trackPageErrors(page, label) {
  page.on('pageerror', (err) => {
    failures += 1;
    console.error(`FAIL ${label}: uncaught page error — ${err.message}`);
  });
}

async function clickButton(page, text, scope = '') {
  const buttons = await page.$$(scope ? `${scope} button` : 'button');
  for (const btn of buttons) {
    const txt = await btn.evaluate((el) => el.textContent ?? '');
    if (txt.includes(text)) {
      await btn.click();
      return;
    }
  }
  throw new Error(`no button matching "${text}"`);
}

async function fillInput(page, selector, value) {
  const els = await page.$$(selector);
  if (els.length === 0) throw new Error(`no input matching "${selector}"`);
  await els[0].click();
  await els[0].type(value, { delay: 0 });
}

async function waitDialog(page) {
  await page.waitForSelector('[role="dialog"]', { visible: true, timeout: 15_000 });
  return page.$eval('[role="dialog"]', (el) => el.textContent ?? '');
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

    // ------------------------------------------------------------------
    // Desktop, light.
    // ------------------------------------------------------------------
    {
      const page = await ctx.newPage();
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
      trackPageErrors(page, 'desktop');

      // --- Proposals list: rows + status filter -------------------------
      await page.goto(`${base}/proposals`, { waitUntil: 'networkidle0' });
      await shot(page, 'p07-proposals-desktop-light', 'Node.js + MCP API integration');

      // Status filter re-queries with an explicit status.
      await page.select('select', 'Pending');
      await new Promise((r) => setTimeout(r, 600));
      const listText = await page.evaluate(() => document.body.innerText);
      if (!listText.includes('Node.js + MCP API integration')) {
        failures += 1;
        console.error('FAIL p07-proposals-desktop-light: filter re-query lost the rows');
      }

      // --- Row select → detail -----------------------------------------
      await clickButton(page, 'Node.js + MCP API integration');
      await new Promise((r) => setTimeout(r, 600));
      const detailText = await page.evaluate(() => document.body.innerText);
      if (!detailText.includes('Hi Beta Labs, I have shipped MCP clients end to end.')) {
        failures += 1;
        console.error('FAIL p07-proposals-desktop-light: detail cover letter missing');
      }
      await new Promise((r) => setTimeout(r, 350));
      await page.screenshot({ path: `${OUT}/p07-proposals-detail-desktop-light.png` });
      console.log('OK   p07-proposals-detail-desktop-light');

      // --- Draft flow: form → create preview → review → confirm ----------
      await page.goto(`${base}/jobs/${encodeURIComponent(JOB_ALPHA)}/propose`, {
        waitUntil: 'networkidle0',
      });
      await shot(page, 'p07-propose-form-desktop-light', 'Applying costs 10 Connects');
      const formText = await page.evaluate(() => document.body.innerText);
      if (!formText.includes('Top client, pays on time')) {
        failures += 1;
        console.error('FAIL p07-propose-form-desktop-light: client feedback row missing');
      }
      if (!formText.includes('MCP dashboard project')) {
        failures += 1;
        console.error('FAIL p07-propose-form-desktop-light: highlights missing');
      }

      // Fill the form.
      const textareas = await page.$$('form textarea');
      if (textareas.length < 2) {
        failures += 1;
        console.error('FAIL p07-propose-form-desktop-light: expected cover + screening textareas');
      }
      if (textareas.length >= 2) {
        await textareas[0].type('I have shipped exactly this stack.', { delay: 0 });
        await textareas[1].type('Because I ship fast.', { delay: 0 });
        await fillInput(page, 'form input[type="number"]', '3000');
      }

        // Step 1: create preview (modal A must appear BEFORE any create call).
        await clickButton(page, 'Continue');
        const dialogAText = await waitDialog(page);
        if (!dialogAText.includes('no Connects are charged')) {
          failures += 1;
          console.error('FAIL p07-propose-form-desktop-light: create modal summary missing');
        }
        await page.screenshot({ path: `${OUT}/p07-create-preview-modal-desktop-light.png` });
        console.log('OK   p07-create-preview-modal-desktop-light');
        await clickButton(page, 'Create preview', '[role="dialog"]');

        // Review stage (boost input available).
        await page.waitForFunction(
          () => document.body.innerText.includes('Review before you submit'),
          { timeout: 15_000 },
        );
        await page.screenshot({ path: `${OUT}/p07-review-desktop-light.png` });
        console.log('OK   p07-review-desktop-light');
        await fillInput(page, 'input[type="number"]', '5');

        // Step 2: confirm submit (modal B).
        await clickButton(page, 'Submit proposal');
        const dialogBText = await waitDialog(page);
        if (!dialogBText.includes('cannot be edited or withdrawn')) {
          failures += 1;
          console.error('FAIL p07-review-desktop-light: submit modal summary missing');
        }
        await clickButton(page, 'Submit proposal', '[role="dialog"]');

        // Submitted view + toast + stored bid.
        await page.waitForFunction(
          (t) => document.body.innerText.includes(t),
          { timeout: 15_000 },
          'Proposal submitted',
        );
        const doneText = await page.evaluate(() => document.body.innerText);
        if (!doneText.includes('Stored bid: 5 Connects')) {
          failures += 1;
          console.error('FAIL p07-submitted-desktop-light: stored bid missing');
        }
        if (!doneText.includes('Status: Submitted')) {
          failures += 1;
          console.error('FAIL p07-submitted-desktop-light: status label missing');
        }
        await new Promise((r) => setTimeout(r, 350));
        await page.screenshot({ path: `${OUT}/p07-submitted-desktop-light.png` });
        console.log('OK   p07-submitted-desktop-light');

        // --- The list now shows the verified proposal ---------------------
        await page.goto(`${base}/proposals`, { waitUntil: 'networkidle0' });
        const listAfter = await page.evaluate(() => document.body.innerText);
        if (!listAfter.includes('Senior React / TypeScript dashboard')) {
          failures += 1;
          console.error('FAIL p07-proposals-after-submit: new proposal not listed');
        }
        await new Promise((r) => setTimeout(r, 350));
        await page.screenshot({ path: `${OUT}/p07-proposals-after-submit-desktop-light.png` });
        console.log('OK   p07-proposals-after-submit-desktop-light');

        // --- Preflight variants: applied + invited -----------------------
        await page.goto(`${base}/jobs/${encodeURIComponent(JOB_CHARLIE)}/propose`, {
          waitUntil: 'networkidle0',
        });
        const appliedText = await page.evaluate(() => document.body.innerText);
        if (!appliedText.toLowerCase().includes('already applied')) {
          failures += 1;
          console.error('FAIL p07-applied-desktop-light: applied notice missing');
        }
        await new Promise((r) => setTimeout(r, 350));
        await page.screenshot({ path: `${OUT}/p07-applied-desktop-light.png` });
        console.log('OK   p07-applied-desktop-light');

        await page.goto(`${base}/jobs/${encodeURIComponent(JOB_BRAVO)}/propose`, {
          waitUntil: 'networkidle0',
        });
        const invitedText = await page.evaluate(() => document.body.innerText);
        if (!invitedText.toLowerCase().includes('invitation')) {
          failures += 1;
          console.error('FAIL p07-invited-desktop-light: invitation notice missing');
        }
        await new Promise((r) => setTimeout(r, 350));
        await page.screenshot({ path: `${OUT}/p07-invited-desktop-light.png` });
        console.log('OK   p07-invited-desktop-light');

        // --- Desktop dark --------------------------------------------------
        // Fresh session: the alpha job would now correctly show the
        // "already applied" notice instead of the form.
        state.submitted = false;
        await page.goto(`${base}/proposals?theme=dark`, { waitUntil: 'networkidle0' });
        await shot(page, 'p07-proposals-desktop-dark', 'Node.js + MCP API integration', true);

        await page.goto(`${base}/jobs/${encodeURIComponent(JOB_ALPHA)}/propose?theme=dark`, {
          waitUntil: 'networkidle0',
        });
      await shot(page, 'p07-propose-form-desktop-dark', 'Applying costs 10 Connects', true);

      await page.close();
    }

    // ------------------------------------------------------------------
    // Mobile (375px), light + dark, with overflow checks.
    // ------------------------------------------------------------------
    {
      const page = await ctx.newPage();
      await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 });
      trackPageErrors(page, 'mobile');

      // Fresh session: layout checks only, so drop the submitted proposal
      // (the alpha job would otherwise correctly show the "already applied"
      // notice instead of the form).
      state.submitted = false;

      await page.goto(`${base}/proposals`, { waitUntil: 'networkidle0' });
      await shot(page, 'p07-proposals-mobile-light', 'Node.js + MCP API integration', false, true);

      await page.goto(`${base}/jobs/${encodeURIComponent(JOB_ALPHA)}/propose`, {
        waitUntil: 'networkidle0',
      });
      await shot(page, 'p07-propose-form-mobile-light', 'Applying costs 10 Connects', false, true);

      await page.goto(`${base}/proposals?theme=dark`, { waitUntil: 'networkidle0' });
      await shot(page, 'p07-proposals-mobile-dark', 'Node.js + MCP API integration', true, true);

      await page.goto(`${base}/jobs/${encodeURIComponent(JOB_ALPHA)}/propose?theme=dark`, {
        waitUntil: 'networkidle0',
      });
      await shot(page, 'p07-propose-form-mobile-dark', 'Applying costs 10 Connects', true, true);

      await page.close();
    }
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
console.log(`All proposal screenshots written to ${OUT}`);
