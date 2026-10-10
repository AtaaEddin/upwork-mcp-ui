import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATA_DIR: z.string().min(1).default('./data'),
  UPWORK_MCP_URL: z.url().default('https://mcp.upwork.com/mcp'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

/**
 * Parse and validate environment configuration.
 * Throws (zod error) on invalid values — fail fast at boot.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return EnvSchema.parse(env);
}
