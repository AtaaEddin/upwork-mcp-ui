#!/usr/bin/env node
/**
 * Browser verification for the SPA (plan 05 DoD: "mobile + desktop, light +
 * dark, verified in a browser"). Drives the system Chromium via
 * puppeteer-core (no browser download) against a running server.
 *
 * Real-instance flow (logs in through the actual form):
 *   npm run build
 *   DATA_DIR=... OWNER_PASSWORD=... NODE_ENV=production APP_SECRET=... \
 *     PORT=8790 node server/dist/index.js
 *   UI_BASE_URL=http://127.0.0.1:8790 VERIFY_PASSWORD=... \
 *     node web/scripts/browser-verify.mjs
 *
 * Banner shots (against a fake API that reports needs_reauth/disconnected —
 * see plan 05, "Out of scope"):
 *   UI_BASE_URL=http://127.0.0.1:8791 BANNER_SHOTS=1 node web/scripts/browser-verify.mjs
 *
 * Screenshots land in $SHOT_DIR (default /tmp/uwu-shots). Exits non-zero if
 * any shot fails.
 */
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const BASE = process.env.UI_BASE_URL ?? 'http://127.0.0.1:8790';
const CHROME = process.env.CHROME_PATH ?? '/snap/bin/chromium';
const OUT = process.env.SHOT_DIR ?? '/tmp/uwu-shots';
const PASSWORD = process.env.VERIFY_PASSWORD ?? '';
const BANNER_SHOTS = process.env.BANNER_SHOTS === '1';

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

let failures = 0;

async function newPage(context, width, height) {
  const page = await context.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  return page;
}

async function shot(page, name, selector) {
  if (selector) {
    try {
      await page.waitForSelector(selector, { timeout: 15_000 });
    } catch (err) {
      failures += 1;
      console.error(`FAIL ${name}: ${err.message}`);
      return;
    }
  }
  await new Promise((r) => setTimeout(r, 250)); // let layout settle
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file });
  console.log(`OK   ${name}`);
}

await mkdir(OUT, { recursive: true });
const defaultCtx = await browser.defaultBrowserContext();

if (BANNER_SHOTS) {
  // /api/upwork/status must report needs_reauth (fake API, see header).
  {
    const page = await newPage(defaultCtx, 1440, 900);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await shot(page, '10-banner-desktop-light', '[role=alert]');
    await page.goto(`${BASE}/?theme=dark`, { waitUntil: 'networkidle0' });
    await shot(page, '11-banner-desktop-dark', '[role=alert]');
    await page.close();
  }
  {
    const page = await newPage(defaultCtx, 375, 812);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await shot(page, '12-banner-mobile-light', '[role=alert]');
    await page.close();
  }
} else {
  if (!PASSWORD) {
    console.error('set VERIFY_PASSWORD (owner password of the running instance)');
    process.exit(2);
  }

  // Login page (desktop, before auth) + log in through the real form.
  {
    const page = await newPage(defaultCtx, 1440, 900);
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    await shot(page, '01-login-desktop-light', 'input[type=password]');
    await page.goto(`${BASE}/login?theme=dark`, { waitUntil: 'networkidle0' });
    await shot(page, '02-login-desktop-dark', 'input[type=password]');

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('input[type=password]', { timeout: 15_000 });
    await page.type('input[type=password]', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForFunction(() => location.pathname === '/', { timeout: 15_000 });

    await shot(page, '03-dashboard-desktop-light', 'h1');
    await page.goto(`${BASE}/?theme=dark`, { waitUntil: 'networkidle0' });
    await shot(page, '04-dashboard-desktop-dark', 'h1');
    await page.goto(`${BASE}/nope`, { waitUntil: 'networkidle0' });
    await shot(page, '05-404-desktop-light', 'h1');
    await page.close();
  }

  // Authenticated mobile (session shared through the default context).
  {
    const page = await newPage(defaultCtx, 375, 812);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await shot(page, '06-dashboard-mobile-light', 'h1');
    await page.goto(`${BASE}/?theme=dark`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('button[aria-label="Open menu"]', { timeout: 15_000 });
    await page.click('button[aria-label="Open menu"]');
    await shot(page, '07-dashboard-mobile-dark-menu', '#mobile-nav');
    await page.close();
  }

  // Fresh (incognito) mobile context for the unauthenticated login page.
  {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx, 375, 812);
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    await shot(page, '08-login-mobile-light', 'input[type=password]');
    await page.goto(`${BASE}/login?theme=dark`, { waitUntil: 'networkidle0' });
    await shot(page, '09-login-mobile-dark', 'input[type=password]');
    await ctx.close();
  }
}

await browser.close();
if (failures > 0) {
  console.error(`${failures} shot(s) failed`);
  process.exit(1);
}
console.log(`All screenshots written to ${OUT}`);
