import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().min(1).default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Encrypts stored OAuth tokens (plan 03) and signs cookies. Required in production. */
  APP_SECRET: z.string().min(32).max(1024).optional(),
  /** One-time owner password bootstrap (headless/Docker first run). */
  OWNER_PASSWORD: z.string().min(8).max(512).optional(),
  SESSION_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(30 * 24 * 60 * 60 * 1000)
    .default(7 * 24 * 60 * 60 * 1000),
  DATA_DIR: z.string().min(1).default('./data'),
  UPWORK_MCP_URL: z.url().default('https://mcp.upwork.com/mcp'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

/**
 * Parse and validate environment configuration.
 * Throws (zod error / Error) on invalid values — fail fast at boot.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const cfg = EnvSchema.parse(env);
  if (cfg.NODE_ENV === 'production' && !cfg.APP_SECRET) {
    throw new Error('APP_SECRET (32+ chars) is required when NODE_ENV=production');
  }
  if (!cfg.APP_SECRET) {
    cfg.APP_SECRET = randomBytes(32).toString('hex');
    if (cfg.NODE_ENV === 'development') {
      console.warn(
        'APP_SECRET not set — using an ephemeral dev secret (sessions and stored tokens do not survive restarts).',
      );
    }
  }
  return cfg;
}
