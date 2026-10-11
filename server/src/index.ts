import { serve } from '@hono/node-server';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { OwnerAuth } from './auth.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { RateLimiter } from './rate-limit.js';
import { SessionService } from './sessions.js';
import { ToolService } from './tools/service.js';
import { ToolCallLog } from './tools/store.js';
import { UpworkAccountService } from './upwork/account.js';
import { UpworkConnectionService } from './upwork/service.js';

const config = loadConfig();
const db = openDatabase(config.DATA_DIR);
const sessions = new SessionService(db, config.SESSION_TTL_MS);
const auth = new OwnerAuth(db, sessions, config.OWNER_PASSWORD);
auth.bootstrap();
const loginLimiter = new RateLimiter(15 * 60 * 1000, 10);

// Plan 03: the single Upwork connection (OAuth 2.1 over the official MCP server).
const publicBase = config.PUBLIC_BASE_URL ?? `http://localhost:${config.PORT}`;
const upwork = new UpworkConnectionService({
  db,
  config,
  redirectUri: `${publicBase.replace(/\/+$/, '')}/api/upwork/callback`,
  // Plan 06: the selected account can never outlive the connection.
  onDisconnected: () => upworkAccount.clear(),
});
upwork.start();

// Plan 06: selected-account persistence (org_uid for every tool call).
const upworkAccount = new UpworkAccountService({ connection: upwork, db });

// Plan 04: tool proxy (ALL tools) + call log.
const toolLog = new ToolCallLog(db);
const tools = new ToolService({
  connection: upwork,
  log: toolLog,
  config,
  logLine: (m) => console.error(m),
});

const app = createApp({
  config,
  auth,
  sessions,
  loginLimiter,
  upwork,
  upworkAccount,
  tools,
  toolLog,
  // Resolves to <repo>/web/dist from both server/src (tsx dev) and server/dist (node).
  staticDir: fileURLToPath(new URL('../../web/dist', import.meta.url)),
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) => {
  console.log(`upwork-mcp-ui listening on http://${config.HOST}:${info.port}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void upwork.dispose().finally(() => {
      server.close();
      process.exit(0);
    });
  });
}
