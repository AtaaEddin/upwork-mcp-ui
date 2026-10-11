import { serve } from '@hono/node-server';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { OwnerAuth } from './auth.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { RateLimiter } from './rate-limit.js';
import { SessionService } from './sessions.js';

const config = loadConfig();
const db = openDatabase(config.DATA_DIR);
const sessions = new SessionService(db, config.SESSION_TTL_MS);
const auth = new OwnerAuth(db, sessions, config.OWNER_PASSWORD);
auth.bootstrap();
const loginLimiter = new RateLimiter(15 * 60 * 1000, 10);

const app = createApp({
  config,
  auth,
  sessions,
  loginLimiter,
  // Resolves to <repo>/web/dist from both server/src (tsx dev) and server/dist (node).
  staticDir: fileURLToPath(new URL('../../web/dist', import.meta.url)),
});

serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) => {
  console.log(`upwork-mcp-ui listening on http://${config.HOST}:${info.port}`);
});
