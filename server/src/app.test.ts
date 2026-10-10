import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadConfig, type AppConfig } from './config.js';

function makeConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig(overrides as NodeJS.ProcessEnv);
}

describe('GET /api/healthz', () => {
  it('returns 200 with the expected shape', async () => {
    const res = await createApp(makeConfig()).request('/api/healthz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string; mcpUrl: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('upwork-mcp-ui');
    expect(body.mcpUrl).toBe('https://mcp.upwork.com/mcp');
  });
});

describe('unknown routes', () => {
  it('returns a JSON 404', async () => {
    const res = await createApp(makeConfig()).request('/api/definitely-missing');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });
});

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const cfg = makeConfig();
    expect(cfg.PORT).toBe(8787);
    expect(cfg.HOST).toBe('0.0.0.0');
    expect(cfg.DATA_DIR).toBe('./data');
    expect(cfg.UPWORK_MCP_URL).toBe('https://mcp.upwork.com/mcp');
  });

  it('coerces string port values', () => {
    expect(makeConfig({ PORT: '9000' }).PORT).toBe(9000);
  });

  it('rejects out-of-range ports', () => {
    expect(() => makeConfig({ PORT: '70000' })).toThrow();
    expect(() => makeConfig({ PORT: '0' })).toThrow();
  });

  it('rejects non-url MCP endpoints', () => {
    expect(() => makeConfig({ UPWORK_MCP_URL: 'not a url' })).toThrow();
  });
});
