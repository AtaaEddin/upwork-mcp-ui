import { Hono, type Context } from 'hono';
import { AppError } from '../errors.js';
import type { UpworkAccountService } from './account.js';
import { REVOKE_HINT_URL, type UpworkConnectionService } from './service.js';

/**
 * Upwork connection API (plan 03) + account selection (plan 06).
 * - POST /api/upwork/connect    — start the flow; returns the authorize URL
 * - GET  /api/upwork/callback   — OAuth callback (public: the browser lands
 *                                  here without a session cookie)
 * - GET  /api/upwork/status     — machine state for the banner/UI
 * - POST /api/upwork/disconnect — local token delete (+ revocation hint)
 * - GET  /api/upwork/account    — selected account (bootstraps once via
 *                                  list_accounts; `?refresh=1` re-lists)
 * - PUT  /api/upwork/account    — select `{orgUid}` (validated upstream)
 *
 * Errors are AppErrors handled by the app-level onError envelope.
 */
export function createUpworkRoutes(
  service: UpworkConnectionService,
  accounts?: UpworkAccountService,
): Hono {
  const app = new Hono();

  app.post('/connect', async (c) => {
    const result = await service.connect();
    if (result.authorizeUrl) return c.json({ authorizeUrl: result.authorizeUrl });
    return c.json({ state: 'connected' });
  });

  app.get('/callback', async (c) => {
    // Full query: code, state, iss[, error/error_description].
    const query = new URL(c.req.url, 'http://localhost').searchParams;
    await service.handleCallback(query);
    // Success: send the browser back to the app (SPA reads /api/upwork/status).
    return c.redirect('/', 302);
  });

  app.get('/status', (c) => c.json(service.status()));

  app.post('/disconnect', async (c) => {
    await service.disconnect();
    return c.json({
      ok: true,
      revokeHint: `Tokens were removed from this app. To fully revoke access, sign in at ${REVOKE_HINT_URL} and manage connected apps.`,
    });
  });

  if (accounts) {
    app.get('/account', async (c) => {
      const refresh = ['1', 'true'].includes(c.req.query('refresh') ?? '');
      return c.json(await accounts.get({ refresh }));
    });

    app.put('/account', async (c) => {
      const body = await readJson(c);
      const maybe = body as { orgUid?: unknown } | null;
      const orgUid =
        maybe !== null && typeof maybe.orgUid === 'string' ? maybe.orgUid.trim() : '';
      if (orgUid === '') throw new AppError('bad_request', 'orgUid is required');
      const account = await accounts.select(orgUid);
      return c.json({ account });
    });
  }

  return app;
}

async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === '') throw new AppError('bad_request', 'Request body is required');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError('bad_request', 'Request body must be valid JSON');
  }
}
