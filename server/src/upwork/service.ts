import { timingSafeEqual } from 'node:crypto';
import {
  AuthorizationServerMismatchError,
  Client,
  IssuerMismatchError,
  OAuthError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from '@modelcontextprotocol/client';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { Db } from '../db.js';
import { UpworkConnectionStore, type UpworkState } from './store.js';
import { UpworkOAuthProvider } from './provider.js';

export const REVOKE_HINT_URL = 'https://www.upwork.com/ab/account-security';

export interface UpworkStatus {
  state: UpworkState;
  /** ISO expiry of the current access token (connected only). */
  expiresAt?: string;
  /** Epoch ms (connected only). */
  connectedAt?: number;
  /** Authorize URL to send the user's browser to (connecting / needs_reauth). */
  pendingAuthorizeUrl?: string;
  /**
   * Account summary via MCP tools — reserved for the tool pages (plan 04/06);
   * `undefined` in plan 03.
   */
  accountSummary?: unknown;
}

export interface UpworkServiceOptions {
  db: Db;
  config: AppConfig;
  /** OAuth callback URL the user's browser lands on (PUBLIC_BASE_URL + path). */
  redirectUri: string;
  /** Keepalive ping interval; default from config (UPWORK_KEEPALIVE_MS). */
  intervalMs?: number;
  /** Refresh window before `expires_at` (default 120 s). */
  refreshBeforeExpiryMs?: number;
  /** Consecutive non-auth keepalive failures before giving up (default 6). */
  failureThreshold?: number;
  now?: () => number;
  log?: (message: string) => void;
}

export interface StartConnectResult {
  authorizeUrl: string;
}

/**
 * Owns the single Upwork connection: OAuth lifecycle (connect / callback /
 * disconnect), re-auth detection, keepalive pings, and the persisted
 * machine state. One instance per process.
 *
 * Error mapping (all through the plan-02 envelope):
 * - AppError('bad_request')    — callback validation failures (state/iss/param)
 * - AppError('conflict')       — connect while already connected
 * - AppError('upstream_error') — Upwork-side failures (discovery, DCR, token I/O)
 */
export class UpworkConnectionService {
  private readonly store: UpworkConnectionStore;
  private readonly provider: UpworkOAuthProvider;
  private client: Client | null = null;
  private timer: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;
  private opQueue: Promise<void> = Promise.resolve();

  constructor(private readonly opts: UpworkServiceOptions) {
    if (!opts.config.APP_SECRET) throw new Error('APP_SECRET is required for the Upwork connection');
    const secret = opts.config.APP_SECRET;
    this.store = new UpworkConnectionStore(opts.db);
    this.provider = new UpworkOAuthProvider({
      store: this.store,
      secret,
      redirectUri: opts.redirectUri,
      clientName: 'upwork-mcp-ui',
      refreshBeforeExpiryMs: opts.refreshBeforeExpiryMs,
      now: opts.now,
      log: opts.log,
    });
  }

  // ---- public API ----------------------------------------------------------

  status(): UpworkStatus {
    const row = this.store.get();
    const status: UpworkStatus = { state: row.state };
    if (row.state === 'connected') {
      if (row.accessExpiresAt !== null) status.expiresAt = new Date(row.accessExpiresAt).toISOString();
      if (row.connectedAt !== null) status.connectedAt = row.connectedAt;
    }
    if (row.pendingAuthorizeUrl && row.state !== 'disconnected') {
      status.pendingAuthorizeUrl = row.pendingAuthorizeUrl;
    }
    return status;
  }

  /**
   * Start (or restart) the authorization flow. Runs SDK discovery + DCR (if
   * needed) + authorize-URL construction, then returns the URL the browser
   * must visit. Safe to call from `disconnected`, `needs_reauth`, or a
   * stale `connecting`.
   */
  async connect(): Promise<StartConnectResult> {
    return this.withLock(async () => {
      const row = this.store.get();
      if (row.state === 'connected') {
        throw new AppError('conflict', 'already connected to Upwork');
      }
      // New flow: drop stale flow material (state token + old redirect).
      // Keep DCR client info + discovery state: the SDK reuses them.
      this.store.clearFlow();
      this.store.set({ state: 'connecting' });
      try {
        await this.connectClient();
        // Reached only if tokens were already valid (e.g. restart with live tokens).
        return { authorizeUrl: '' };
      } catch (err) {
        if (UnauthorizedError.isInstance(err)) {
          const pending = this.store.get().pendingAuthorizeUrl;
          if (!pending) throw new AppError('internal_error', 'authorization flow did not start');
          return { authorizeUrl: pending };
        }
        this.store.set({ state: 'disconnected' });
        throw new AppError('upstream_error', 'failed to reach the Upwork MCP server');
      }
    });
  }

  /**
   * Handle the OAuth callback query (already URL-decoded). Validates CSRF
   * state, completes `finishAuth` (iss + code exchange, tokens persisted by
   * the SDK), then establishes the MCP session.
   */
  async handleCallback(query: URLSearchParams): Promise<void> {
    await this.withLock(async () => {
      if (this.store.get().state === 'connected') {
        throw new AppError('conflict', 'already connected');
      }
      const code = query.get('code');
      const stateParam = query.get('state');
      if (!code || !stateParam) {
        throw new AppError('bad_request', 'missing code or state');
      }
      const saved = this.store.get().flowState;
      if (!saved || !this.safeEqual(stateParam, saved)) {
        this.store.clearFlow();
        this.store.set({ state: 'disconnected' });
        throw new AppError('bad_request', 'state mismatch');
      }
      const transport = new StreamableHTTPClientTransport(new URL(this.opts.config.UPWORK_MCP_URL), {
        authProvider: this.provider,
      });
      try {
        await transport.finishAuth(query);
      } catch (err) {
        await transport.close().catch(() => undefined);
        if (
          err instanceof IssuerMismatchError ||
          err instanceof AuthorizationServerMismatchError
        ) {
          // Mix-up or issuer change: destroy credentials, force full re-auth.
          this.store.clearAll();
          throw new AppError('bad_request', 'issuer mismatch');
        }
        if (err instanceof UnauthorizedError || err instanceof OAuthError) {
          this.store.clearFlow();
          this.store.set({ state: 'disconnected' });
          throw new AppError('bad_request', 'authorization failed');
        }
        throw err;
      }
      await transport.close().catch(() => undefined);
      await this.connectClient();
    });
  }

  /**
   * Disconnect: close the MCP session, delete local tokens + flow material.
   * DCR client info is kept (re-register-free reconnect). Tokens must be
   * revoked by the user at Upwork (single public client; we hold no secret).
   */
  async disconnect(): Promise<void> {
    await this.withLock(async () => {
      await this.teardown();
      this.stopKeepalive();
      this.store.clearTokens();
      this.store.clearFlow();
      this.store.set({ state: 'disconnected' });
      this.opts.log?.('upwork connection disconnected by user');
    });
  }

  /**
   * One keepalive tick: `ping` over the live MCP session. `UnauthorizedError`
   * (refresh failed inside the SDK) ⇒ `needs_reauth` (keepalive stays off
   * until the user reconnects). Other errors are logged, state unchanged.
   */
  async ping(): Promise<void> {
    const row = this.store.get();
    if (row.state !== 'connected') return;
    try {
      const client = await this.ensureClient();
      await client.ping();
      this.consecutiveFailures = 0;
    } catch (err) {
      if (UnauthorizedError.isInstance(err)) {
        // The SDK already tried refresh; it failed and recorded a fresh
        // authorize URL (state flipped to `needs_reauth` by the provider).
        this.opts.log?.('upwork token no longer valid — re-authentication required');
      } else {
        this.consecutiveFailures += 1;
        this.opts.log?.('upwork keepalive failed');
        if (err instanceof Error) this.opts.log?.(err.message);
        const threshold = this.opts.failureThreshold ?? 6;
        if (this.consecutiveFailures >= threshold) {
          this.opts.log?.('upwork keepalive keeps failing — marking connection as needs_reauth');
          this.store.set({ state: 'needs_reauth' });
        }
      }
    }
  }

  start(): void {
    if (this.timer) return;
    const intervalMs = this.opts.intervalMs ?? this.opts.config.UPWORK_KEEPALIVE_MS;
    this.timer = setInterval(() => {
      void this.ping().catch(() => undefined);
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopKeepalive();
  }

  /** Close the MCP session and clear in-memory state (shutdown path). */
  async dispose(): Promise<void> {
    this.stopKeepalive();
    await this.teardown();
  }

  // ---- internals -----------------------------------------------------------

  private withLock<T>(op: () => Promise<T>): Promise<T> {
    const run = this.opQueue.then(op, op);
    this.opQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async ensureClient(): Promise<Client> {
    if (this.client) return this.client;
    // Restart with state=connected: rebuild the session from persisted tokens.
    await this.connectClient();
    return this.client!;
  }

  /**
   * Create a fresh transport + client and connect. On success the state is
   * `connected`. When tokens are missing/expired the SDK's 401 path records
   * the authorize URL, flips the state (via the provider), and throws
   * `UnauthorizedError` — that is the "start flow" outcome, not a failure.
   */
  private async connectClient(): Promise<void> {
    await this.teardown();
    const transport = new StreamableHTTPClientTransport(new URL(this.opts.config.UPWORK_MCP_URL), {
      authProvider: this.provider,
    });
    const client = new Client({ name: 'upwork-mcp-ui', version: '0.1.0' });
    let connected = false;
    try {
      await client.connect(transport);
      connected = true;
    } finally {
      if (!connected) {
        await client.close().catch(() => undefined);
        await transport.close().catch(() => undefined);
      }
    }
    this.client = client;
    const row = this.store.get();
    const now = this.opts.now ?? Date.now;
    if (row.state !== 'connected') {
      this.store.set({
        state: 'connected',
        connectedAt: row.connectedAt ?? now(),
        flowState: null,
        pendingAuthorizeUrl: null,
      });
    }
  }

  private async teardown(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) {
      await client.close().catch(() => undefined);
    }
  }

  private stopKeepalive(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private safeEqual(a: string, b: string): boolean {
    const ha = Buffer.from(a, 'utf8');
    const hb = Buffer.from(b, 'utf8');
    if (ha.length !== hb.length) return false;
    return timingSafeEqual(ha, hb);
  }
}
