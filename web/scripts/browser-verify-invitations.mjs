#!/usr/bin/env node
/**
 * Browser verification for plan 07b (Invitations & offers) in a REAL
 * connected state.
 *
 * Same approach as browser-verify-proposals.mjs (plan 07a): the built SPA is
 * served from a fake "connected" backend answering the exact `/api` surface,
 * so a real Chromium drives the full write flows:
 *   /invitations — invitations tab (list → inline detail → accept/decline),
 *   offers tab — accept (binding → finalize link), decline + request changes
 *   (preview → second confirm_preview step), list refresh + toast after
 *   direct successes, finalize→reload showing the invitation disappearing,
 *   plus desktop dark + mobile light/dark with overflow checks.
 *
 * Usage:
 *   npm run build
 *   CHROME_PATH=/snap/bin/chromium SHOT_DIR=/tmp/uwu-shots-07b \
 *     node web/scripts/browser-verify-invitations.mjs
 *
 * Exits non-zero on any failed shot/assertion.
 */
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? '/snap/bin/chromium';
const OUT = process.env.SHOT_DIR ?? '/tmp/uwu-shots-07b';
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

const INVITATIONS = [
  {
    invitation_id: 'inv-1',
    job_key: '~02jobdelta',
    job_id: '141',
    title: 'React dashboard for ops team',
    client_name: 'Delta Co',
    rate: '$60/hr',
    expires_at: '2026-10-20T00:00:00Z',
    status: 'Open',
  },
  {
    invitation_id: 'inv-2',
    job_key: '~02jobgamma',
    job_id: '142',
    title: 'Brand refresh illustrations',
    client_name: 'Gamma Studio',
    rate: '$45/hr',
    expires_at: '2026-10-18T00:00:00Z',
    status: 'Open',
  },
];

const OFFERS = [
  {
    id: 'off-1',
    job_key: '~02jobbravo',
    job_id: '112',
    job_title: 'Backend fix + CI',
    client_name: 'Bravo Labs',
    hourly_rate: 55,
    status: 'Open',
  },
  {
    id: 'off-2',
    job_key: '~02jobcara',
    job_id: '113',
    job_title: 'Site audit',
    client_name: 'Cara Media',
    fixed_price: 4200,
    status: 'Open',
  },
  {
    id: 'off-3',
    job_key: '~02jobdelta',
    job_id: '141',
    job_title: 'MCP tooling spike',
    client_name: 'Delta Co',
    hourly_rate: 70,
    status: 'Open',
  },
];

const TOOLS = [
  'upwork__list_freelancer_proposals',
  'upwork__list_offers',
  'upwork__manage_proposals',
  'upwork__respond_to_offer',
  'upwork__confirm_preview',
].map((name) => ({ name, description: `Fake ${name}`, inputSchema: { type: 'object' } }));

/** Mutable world state so refreshes show consequences. */
const state = {
  /** inv-1 accepted locally — still listed until the owner finishes on upwork.com. */
  inv1Accepted: false,
  /** Simulates the owner completing the binding step on upwork.com. */
  inv1Finalized: false,
  inv2Declined: false,
  off1Accepted: false,
  off2Declined: false,
  off3ChangesRequested: false,
};

function invitationsNow() {
  return INVITATIONS.filter((inv) => {
    if (inv.invitation_id === 'inv-1') return state.inv1Accepted ? !state.inv1Finalized : true;
    if (inv.invitation_id === 'inv-2') return !state.inv2Declined;
    return true;
  });
}

function offersNow() {
  return OFFERS.filter((off) => {
    if (off.id === 'off-2') return !state.off2Declined;
    return true;
  }).map((off) =>
    off.id === 'off-3' && state.off3ChangesRequested
      ? { ...off, status: 'Changes requested' }
      : off,
  );
}

function listProposals(args) {
  const action = args?.action;
  if (action === 'invitations') {
    return {
      isError: false,
      ms: 4,
      content: [],
      structuredContent: { invitations: invitationsNow() },
    };
  }
  return { isError: false, ms: 4, content: [], structuredContent: { proposals: [] } };
}

function listOffers(args) {
  if (args?.action !== 'list_mine') {
    return { isError: false, ms: 4, content: [], structuredContent: { offers: [] } };
  }
  return { isError: false, ms: 4, content: [], structuredContent: { offers: offersNow() } };
}

function manageProposals(args) {
  const action = args?.action;
  if (action === 'accept_invitation') {
    state.inv1Accepted = true;
    return {
      isError: false,
      ms: 6,
      content: [],
      structuredContent: {
        status: 'action_required',
        message: 'Acceptance stored — finish it on Upwork to make it binding.',
        finalize_url: 'https://www.upwork.com/ab/2/invitation-141-finish',
      },
    };
  }
  if (action === 'decline_invitation') {
    state.inv2Declined = true;
    return { isError: false, ms: 5, content: [], structuredContent: { status: 'declined' } };
  }
  return { isError: false, ms: 3, content: [], structuredContent: {} };
}

function respondToOffer(args) {
  const action = args?.action;
  if (action === 'accept' && args.offer_id === 'off-1') {
    state.off1Accepted = true;
    return {
      isError: false,
      ms: 6,
      content: [],
      structuredContent: {
        status: 'action_required',
        finalize_url: 'https://www.upwork.com/ab/2/offer-112-finish',
      },
    };
  }
  if (action === 'decline' && args.offer_id === 'off-2') {
    return {
      isError: false,
      ms: 5,
      content: [],
      structuredContent: {
        preview_id: 'pv-off2-decline',
        type: 'offer_decline',
        message: 'Decline stored as a preview — confirm to send it.',
      },
    };
  }
  if (action === 'request_changes' && args.offer_id === 'off-3') {
    return {
      isError: false,
      ms: 5,
      content: [],
      structuredContent: {
        preview_id: 'pv-off3-changes',
        type: 'offer_request_changes',
        received_message: args.message,
      },
    };
  }
  return { isError: false, ms: 3, content: [], structuredContent: { status: 'ok' } };
}

function confirmPreview(args) {
  if (args?.action !== 'confirm') {
    return { isError: false, ms: 3, content: [], structuredContent: {} };
  }
  if (args.type === 'offer_decline' && args.preview_id === 'pv-off2-decline') {
    state.off2Declined = true;
  }
  if (args.type === 'offer_request_changes' && args.preview_id === 'pv-off3-changes') {
    state.off3ChangesRequested = true;
  }
  return { isError: false, ms: 5, content: [], structuredContent: { status: 'confirmed' } };
}

function toolCall(tool, args) {
  switch (tool) {
    case 'upwork__list_freelancer_proposals':
      return listProposals(args);
    case 'upwork__list_offers':
      return listOffers(args);
    case 'upwork__manage_proposals':
      return manageProposals(args);
    case 'upwork__respond_to_offer':
      return respondToOffer(args);
    case 'upwork__confirm_preview':
      return confirmPreview(args);
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
    // SPA fallback for client-side routes
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

async function waitDialog(page) {
  await page.waitForSelector('[role="dialog"]', { visible: true, timeout: 15_000 });
  return page.$eval('[role="dialog"]', (el) => el.textContent ?? '');
}

const bodyText = (page) => page.evaluate(() => document.body.innerText);

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
    // Desktop, light — invitations.
    // ------------------------------------------------------------------
    {
      const page = await ctx.newPage();
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
      trackPageErrors(page, 'desktop');

      // --- Invitations list ---------------------------------------------
      await page.goto(`${base}/invitations`, { waitUntil: 'networkidle0' });
      await shot(page, 'p07b-invitations-desktop-light', 'React dashboard for ops team');
      let text = await bodyText(page);
      if (!text.includes('Brand refresh illustrations')) {
        failures += 1;
        console.error('FAIL p07b-invitations-desktop-light: second invitation missing');
      }
      if (!text.includes('$60/hr')) {
        failures += 1;
        console.error('FAIL p07b-invitations-desktop-light: rate missing');
      }

      // --- Row select → inline detail + actions -------------------------
      await clickButton(page, 'React dashboard for ops team');
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        { timeout: 15_000 },
        'Invitation details',
      );
      text = await bodyText(page);
      if (!text.includes('Delta Co')) {
        failures += 1;
        console.error('FAIL p07b-invitation-detail-desktop-light: client missing in detail');
      }
      await new Promise((r) => setTimeout(r, 350));
      await page.screenshot({ path: `${OUT}/p07b-invitation-detail-desktop-light.png` });
      console.log('OK   p07b-invitation-detail-desktop-light');

      // --- Binding accept: confirm modal → finalize link -----------------
      await clickButton(page, 'Accept invitation');
      const acceptDialog = await waitDialog(page);
      if (!acceptDialog.toLowerCase().includes('binding')) {
        failures += 1;
        console.error('FAIL p07b-accept-modal-desktop-light: binding summary missing');
      }
      await page.screenshot({ path: `${OUT}/p07b-accept-modal-desktop-light.png` });
      console.log('OK   p07b-accept-modal-desktop-light');
      await clickButton(page, 'Accept', '[role="dialog"]');
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        { timeout: 15_000 },
        'Finish on upwork.com',
      );
      const finishHref = await page.$eval('a[href*="invitation-141-finish"]', (a) => a.href);
      if (!finishHref.includes('invitation-141-finish')) {
        failures += 1;
        console.error(`FAIL p07b-accept-done-desktop-light: finalize href wrong: ${finishHref}`);
      }
      await new Promise((r) => setTimeout(r, 350));
      await page.screenshot({ path: `${OUT}/p07b-accept-done-desktop-light.png` });
      console.log('OK   p07b-accept-done-desktop-light');

      // --- After the owner finishes on upwork.com → list refreshes -------
      state.inv1Finalized = true; // simulate completion on upwork.com
      await page.reload({ waitUntil: 'networkidle0' });
      text = await bodyText(page);
      if (text.includes('React dashboard for ops team')) {
        failures += 1;
        console.error('FAIL p07b-after-finalize-desktop-light: accepted invitation still listed');
      }
      if (!text.includes('Brand refresh illustrations')) {
        failures += 1;
        console.error('FAIL p07b-after-finalize-desktop-light: remaining invitation lost');
      }
      await new Promise((r) => setTimeout(r, 350));
      await page.screenshot({ path: `${OUT}/p07b-after-finalize-desktop-light.png` });
      console.log('OK   p07b-after-finalize-desktop-light');

      // --- Direct decline: two-step modal → success + list refresh -------
      await clickButton(page, 'Brand refresh illustrations');
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        { timeout: 15_000 },
        'Invitation details',
      );
      await clickButton(page, 'Decline');
      const declineDialog = await waitDialog(page);
      if (!declineDialog.toLowerCase().includes('decline')) {
        failures += 1;
        console.error('FAIL p07b-decline-modal-desktop-light: decline summary missing');
      }
      await clickButton(page, 'Decline', '[role="dialog"]');
      await page.waitForFunction(
        (t) => !document.body.innerText.includes(t),
        { timeout: 15_000 },
        'Brand refresh illustrations',
      );
      text = await bodyText(page);
      if (text.toLowerCase().includes('no open invitations')) {
        // Expected: both invitations handled.
      } else {
        failures += 1;
        console.error('FAIL p07b-declined-desktop-light: list not refreshed after decline');
      }
      await new Promise((r) => setTimeout(r, 350));
      await page.screenshot({ path: `${OUT}/p07b-declined-desktop-light.png` });
      console.log('OK   p07b-declined-desktop-light');

      // --- Offers tab -----------------------------------------------------
      await clickButton(page, 'Offers');
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        { timeout: 15_000 },
        'Backend fix + CI',
      );
      text = await bodyText(page);
      if (!text.includes('Site audit') || !text.includes('MCP tooling spike')) {
        failures += 1;
        console.error('FAIL p07b-offers-desktop-light: offers list incomplete');
      }
      if (!text.includes('$55/hr') || !text.includes('$4,200')) {
        failures += 1;
        console.error('FAIL p07b-offers-desktop-light: offer rates missing');
      }
      await shot(page, 'p07b-offers-desktop-light', 'MCP tooling spike');

      // --- Offer accept (binding) -----------------------------------------
      await clickButton(page, 'Backend fix + CI');
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        { timeout: 15_000 },
        'Offer details',
      );
      await clickButton(page, 'Accept offer');
      await waitDialog(page);
      await page.screenshot({ path: `${OUT}/p07b-offer-accept-modal-desktop-light.png` });
      console.log('OK   p07b-offer-accept-modal-desktop-light');
      await clickButton(page, 'Accept', '[role="dialog"]');
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        { timeout: 15_000 },
        'Finish on upwork.com',
      );
      const offerHref = await page.$eval('a[href*="offer-112-finish"]', (a) => a.href);
      if (!offerHref.includes('offer-112-finish')) {
        failures += 1;
        console.error(`FAIL p07b-offer-accept-done-desktop-light: finalize href wrong: ${offerHref}`);
      }
      await new Promise((r) => setTimeout(r, 350));
      await page.screenshot({ path: `${OUT}/p07b-offer-accept-done-desktop-light.png` });
      console.log('OK   p07b-offer-accept-done-desktop-light');

      // Close the done modal (its overlay would otherwise block the list).
      await clickButton(page, 'Done', '[role="dialog"]');
      await page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 15_000 });

      // --- Offer decline (preview → second confirm) -----------------------
      await clickButton(page, 'Site audit');
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        { timeout: 15_000 },
        'Offer details',
      );
      await clickButton(page, 'Decline');
      const offerDeclineDialog = await waitDialog(page);
      if (!offerDeclineDialog.toLowerCase().includes('preview')) {
        failures += 1;
        console.error('FAIL p07b-offer-decline-modal-desktop-light: two-step summary missing');
      }
      await clickButton(page, 'Decline', '[role="dialog"]');
      // Step 1 returns a preview → dialog A closes and dialog B (the second
      // confirm) opens. Wait for B's unique text to avoid the transition race.
      await page.waitForFunction(
        () => {
          const d = document.querySelector('[role="dialog"]');
          return d?.textContent?.includes('stored this as a preview') ?? false;
        },
        { timeout: 15_000 },
      );
      await page.screenshot({ path: `${OUT}/p07b-offer-decline-confirm-desktop-light.png` });
      console.log('OK   p07b-offer-decline-confirm-desktop-light');
      await clickButton(page, 'Confirm', '[role="dialog"]');
      await page.waitForFunction(
        (t) => !document.body.innerText.includes(t),
        { timeout: 15_000 },
        'Site audit',
      );
      text = await bodyText(page);
      if (text.includes('Site audit')) {
        failures += 1;
        console.error('FAIL p07b-offer-declined-desktop-light: declined offer still listed');
      }
      await new Promise((r) => setTimeout(r, 350));
      await page.screenshot({ path: `${OUT}/p07b-offer-declined-desktop-light.png` });
      console.log('OK   p07b-offer-declined-desktop-light');

      // --- Offer request changes (message → preview → confirm) ------------
      await clickButton(page, 'MCP tooling spike');
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        { timeout: 15_000 },
        'Offer details',
      );
      await clickButton(page, 'Request changes');
      const rcDialog = await waitDialog(page);
      if (!rcDialog.toLowerCase().includes('proposed changes')) {
        failures += 1;
        console.error('FAIL p07b-offer-rc-modal-desktop-light: message summary missing');
      }
      const textareas = await page.$$('textarea');
      if (textareas.length === 0) {
        failures += 1;
        console.error('FAIL p07b-offer-rc-modal-desktop-light: message textarea missing');
      } else {
        await textareas[0].type('I can start Monday and need one more week.', { delay: 0 });
      }
      await page.screenshot({ path: `${OUT}/p07b-offer-rc-filled-desktop-light.png` });
      console.log('OK   p07b-offer-rc-filled-desktop-light');
      await clickButton(page, 'Send request', '[role="dialog"]');
      await page.waitForFunction(
        () => {
          const d = document.querySelector('[role="dialog"]');
          return d?.textContent?.includes('stored this as a preview') ?? false;
        },
        { timeout: 15_000 },
      );
      await clickButton(page, 'Confirm', '[role="dialog"]');
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        { timeout: 15_000 },
        'Changes requested',
      );
      await new Promise((r) => setTimeout(r, 350));
      await page.screenshot({ path: `${OUT}/p07b-offer-rc-done-desktop-light.png` });
      console.log('OK   p07b-offer-rc-done-desktop-light');

      // --- Desktop dark ----------------------------------------------------
      await page.goto(`${base}/invitations?theme=dark`, { waitUntil: 'networkidle0' });
      // Both invitations were handled in this session; the dark shot shows
      // the resulting empty state — still a valid layout check.
      await shot(page, 'p07b-invitations-desktop-dark', 'Invitations & offers', true);

      await page.goto(`${base}/invitations?tab=offers&theme=dark`, { waitUntil: 'networkidle0' });
      await shot(page, 'p07b-offers-desktop-dark', 'MCP tooling spike', true);

      await page.close();
    }

    // ------------------------------------------------------------------
    // Mobile (375px), light + dark, with overflow checks.
    // ------------------------------------------------------------------
    {
      const page = await ctx.newPage();
      await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 });
      trackPageErrors(page, 'mobile');

      // Fresh world: everything open again.
      Object.assign(state, {
        inv1Accepted: false,
        inv1Finalized: false,
        inv2Declined: false,
        off1Accepted: false,
        off2Declined: false,
        off3ChangesRequested: false,
      });

      await page.goto(`${base}/invitations`, { waitUntil: 'networkidle0' });
      await shot(page, 'p07b-invitations-mobile-light', 'React dashboard for ops team', false, true);

      await clickButton(page, 'React dashboard for ops team');
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        { timeout: 15_000 },
        'Invitation details',
      );
      await shot(page, 'p07b-invitation-detail-mobile-light', 'Accept invitation', false, true);

      await clickButton(page, 'Accept invitation');
      await waitDialog(page);
      await shot(page, 'p07b-accept-modal-mobile-light', 'Accept invitation', false, true);

      await page.goto(`${base}/invitations?tab=offers`, { waitUntil: 'networkidle0' });
      await shot(page, 'p07b-offers-mobile-light', 'Backend fix + CI', false, true);

      await clickButton(page, 'MCP tooling spike');
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        { timeout: 15_000 },
        'Offer details',
      );
      await clickButton(page, 'Request changes');
      const rcMobileDialog = await waitDialog(page);
      if (!rcMobileDialog.toLowerCase().includes('request changes')) {
        failures += 1;
        console.error('FAIL p07b-offer-rc-modal-mobile-light: rc dialog missing');
      }
      await shot(page, 'p07b-offer-rc-modal-mobile-light', 'Request changes', false, true);

      // Dark variants.
      await page.goto(`${base}/invitations?theme=dark`, { waitUntil: 'networkidle0' });
      await shot(page, 'p07b-invitations-mobile-dark', 'Brand refresh illustrations', true, true);

      await page.goto(`${base}/invitations?tab=offers&theme=dark`, { waitUntil: 'networkidle0' });
      await shot(page, 'p07b-offers-mobile-dark', 'Site audit', true, true);

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
console.log(`All invitation/offer screenshots written to ${OUT}`);
