import { Hono } from 'hono';
import type { AppConfig } from './config.js';

/**
 * Build the HTTP app. Kept separate from the server entry so tests can
 * exercise the full HTTP surface via `app.request()`.
 */
export function createApp(config: AppConfig): Hono {
  const app = new Hono();

  app.get('/api/healthz', (c) =>
    c.json({
      status: 'ok',
      service: 'upwork-mcp-ui',
      mcpUrl: config.UPWORK_MCP_URL,
      time: new Date().toISOString(),
    }),
  );

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    console.error('unhandled error:', err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}
