import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

/**
 * Fake Upwork MCP + OAuth authorization server for tests (plan 03).
 *
 * Serves, on one loopback origin:
 * - RFC 9728 protected-resource + OAuth AS discovery documents
 * - DCR (`POST /register`), token endpoint (`POST /token`), MCP endpoint
 *   (`POST /mcp`, Streamable HTTP: initialize / ping / notifications)
 * - 401 + WWW-Authenticate on /mcp for missing/invalid bearer tokens
 *
 * The "browser" step is simulated by tests calling {@link FakeUpwork.issueCode}
 * and then hitting our callback endpoint with `code` + `state` + `iss`.
 */
export interface FakeUpwork {
  origin: string;
  mcpUrl: string;
  issuer: string;
  /** Seconds granted to issued access tokens (`expires_in`). */
  accessTokenTtlSec: number;
  /** When true, refresh-token grants fail with `invalid_grant`. */
  failRefresh: boolean;
  registerCount: number;
  registeredClientIds: string[];
  tokenStats: { authorizationCode: number; refresh: number };
  issuedAccessTokens: string[];
  issuedRefreshTokens: string[];
  lastMcpBearer?: string;
  mcpStats: { initialize: number; ping: number; other: number; unauthenticated: number };
  /** Issue an authorization code (the fake "browser consent" step). */
  issueCode(): string;
  /** Invalidate every access token issued so far (refresh tokens stay valid). */
  invalidateAccessTokens(): void;
  /** When set, /mcp answers this HTTP status (simulates upstream outages). */
  mcpFailWith?: number;
  close(): Promise<void>;
}

export interface FakeUpworkOptions {
  accessTokenTtlSec?: number;
  port?: number;
  host?: string;
}

interface JsonRpc {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

export async function startFakeUpwork(opts: FakeUpworkOptions = {}): Promise<FakeUpwork> {
  const { accessTokenTtlSec = 3600, host = '127.0.0.1', port = 0 } = opts;
  const codes = new Set<string>();
  const validAccessTokens = new Set<string>();
  const state = {
    registerCount: 0,
    registeredClientIds: [] as string[],
    tokenStats: { authorizationCode: 0, refresh: 0 },
    issuedAccessTokens: [] as string[],
    issuedRefreshTokens: [] as string[],
    lastMcpBearer: undefined as string | undefined,
    mcpStats: { initialize: 0, ping: 0, other: 0, unauthenticated: 0 },
  };
  let failRefreshFlag = false;
  let mcpFailWith: number | undefined;
  let seq = 0;
  let origin = '';
  const nextId = (prefix: string): string => `${prefix}-${++seq}`;

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch((err) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource') {
      return json(res, 200, {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        resource_name: 'Fake Upwork MCP',
        bearer_methods_supported: ['header'],
      });
    }
    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
      return json(res, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        revocation_endpoint: `${origin}/revoke`,
        registration_endpoint: `${origin}/register`,
        grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
    }

    if (req.method === 'POST' && url.pathname === '/register') {
      const body = (await readJson(req)) as { redirect_uris?: string[] };
      state.registerCount += 1;
      const clientId = nextId('client');
      state.registeredClientIds.push(clientId);
      return json(res, 200, {
        client_id: clientId,
        redirect_uris: body.redirect_uris ?? [],
        client_id_issued_at: Math.floor(Date.now() / 1000),
        token_endpoint_auth_method: 'none',
      });
    }

    if (req.method === 'POST' && url.pathname === '/token') {
      const raw = await readBody(req);
      const params = new URLSearchParams(raw);
      const grant = params.get('grant_type');
      if (grant === 'authorization_code') {
        const code = params.get('code') ?? '';
        if (!codes.has(code)) {
          return json(res, 400, { error: 'invalid_grant', error_description: 'unknown code' });
        }
        codes.delete(code);
        state.tokenStats.authorizationCode += 1;
        const access = nextId('at');
        const refresh = nextId('rt');
        validAccessTokens.add(access);
        state.issuedAccessTokens.push(access);
        state.issuedRefreshTokens.push(refresh);
        return json(res, 200, {
          access_token: access,
          token_type: 'Bearer',
          expires_in: accessTokenTtlSec,
          refresh_token: refresh,
          scope: 'mcp',
        });
      }
      if (grant === 'refresh_token') {
        const refresh = params.get('refresh_token') ?? '';
        if (failRefreshFlag || !state.issuedRefreshTokens.includes(refresh)) {
          return json(res, 400, { error: 'invalid_grant', error_description: 'refresh denied' });
        }
        state.tokenStats.refresh += 1;
        const access = nextId('at');
        validAccessTokens.add(access);
        state.issuedAccessTokens.push(access);
        return json(res, 200, {
          access_token: access,
          token_type: 'Bearer',
          expires_in: accessTokenTtlSec,
          refresh_token: refresh,
          scope: 'mcp',
        });
      }
      return json(res, 400, { error: 'unsupported_grant_type' });
    }

    if (url.pathname === '/mcp') {
      const auth = req.headers['authorization'];
      const bearer =
        typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')
          ? auth.slice('bearer '.length)
          : undefined;
      if (req.method === 'DELETE') {
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET') {
        // No SSE stream support; auth first (401 before 405).
        if (!bearer || !validAccessTokens.has(bearer)) {
          state.mcpStats.unauthenticated += 1;
          return unauthorized(res, origin);
        }
        res.writeHead(405, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
      }
      if (mcpFailWith) {
        res.writeHead(mcpFailWith, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'upstream failure' }));
        return;
      }
      if (!bearer || !validAccessTokens.has(bearer)) {
        state.mcpStats.unauthenticated += 1;
        return unauthorized(res, origin);
      }
      state.lastMcpBearer = bearer;
      const raw = await readBody(req);
      const message = raw ? (JSON.parse(raw) as JsonRpc) : undefined;
      if (!message || message.method === undefined) {
        res.writeHead(400);
        res.end();
        return;
      }
      if (message.method === 'initialize') {
        state.mcpStats.initialize += 1;
        return jsonRpc(res, message, {
          protocolVersion: (message.params as { protocolVersion?: string } | undefined)?.protocolVersion,
          capabilities: {},
          serverInfo: { name: 'fake-upwork-mcp', version: '1.0.0' },
        });
      }
      if (message.method === 'ping') {
        state.mcpStats.ping += 1;
        jsonRpc(res, message, {});
        return;
      }
      if (message.id === undefined) {
        // Notification (e.g. notifications/initialized): 202 Accepted, no body.
        state.mcpStats.other += 1;
        res.writeHead(202);
        res.end();
        return;
      }
      state.mcpStats.other += 1;
      jsonRpc(res, message, {});
    }

    res.writeHead(404);
    res.end();
  }

  server.listen(port, host);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address() as AddressInfo;
  origin = `http://${host}:${addr.port}`;

  const fake: FakeUpwork = {
    get origin(): string {
      return origin;
    },
    get mcpUrl(): string {
      return `${origin}/mcp`;
    },
    get issuer(): string {
      return origin;
    },
    accessTokenTtlSec,
    get failRefresh(): boolean {
      return failRefreshFlag;
    },
    set failRefresh(v: boolean) {
      failRefreshFlag = v;
    },
    get mcpFailWith(): number | undefined {
      return mcpFailWith;
    },
    set mcpFailWith(v: number | undefined) {
      mcpFailWith = v;
    },
    get registerCount(): number {
      return state.registerCount;
    },
    get registeredClientIds(): string[] {
      return state.registeredClientIds;
    },
    get tokenStats() {
      return state.tokenStats;
    },
    get issuedAccessTokens(): string[] {
      return state.issuedAccessTokens;
    },
    get issuedRefreshTokens(): string[] {
      return state.issuedRefreshTokens;
    },
    get lastMcpBearer(): string | undefined {
      return state.lastMcpBearer;
    },
    get mcpStats() {
      return state.mcpStats;
    },
    issueCode(): string {
      const code = `code-${randomBytes(8).toString('hex')}`;
      codes.add(code);
      return code;
    },
    invalidateAccessTokens(): void {
      validAccessTokens.clear();
    },
    close(): Promise<void> {
      server.closeAllConnections?.();
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
  return fake;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function jsonRpc(res: ServerResponse, message: JsonRpc, result: unknown): void {
  json(res, 200, { jsonrpc: '2.0', id: message.id, result });
}

function unauthorized(res: ServerResponse, origin: string): void {
  res.writeHead(401, {
    'content-type': 'application/json',
    'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", error="invalid_token"`,
  });
  res.end(JSON.stringify({ error: 'unauthorized' }));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  return JSON.parse(await readBody(req));
}
