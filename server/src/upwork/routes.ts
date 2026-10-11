import { Hono } from 'hono';
import { REVOKE_HINT_URL, type UpworkConnectionService } from './service.js';

/**
 * Upwork connection API (plan 03).
 * - POST /api/upwork/connect    — start the flow; returns the authorize URL
 * - GET  /api/upwork/callback   — OAuth callback (public: the browser lands
 *                                  here without a session cookie)
 * - GET  /api/upwork/status     — machine state for the banner/UI
 * - POST /api/upwork/disconnect — local token delete (+ revocation hint)
 *
 * Errors are AppErrors handled by the app-level onError envelope.
 */
export function createUpworkRoutes(service: UpworkConnectionService): Hono {
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

  return app;
}
