import { randomBytes } from 'node:crypto';
import {
  refreshAuthorization,
  type OAuthClientInformationContext,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from '@modelcontextprotocol/client';
import { decryptJson, encryptJson } from './crypto.js';
import type { UpworkConnectionStore } from './store.js';

/**
 * SQLite-backed `OAuthClientProvider` for the Upwork MCP authorization server.
 *
 * - DCR client credentials, tokens, PKCE verifier and discovery state persist
 *   encrypted in the `upwork_connection` row (keyed by issuer — there is one
 *   issuer per deployment, the persisted value guards against AS changes).
 * - `tokens()` is the SDK's per-request bearer read, so it doubles as the
 *   proactive refresh point (single-flight, refresh window before expiry).
 * - `redirectToAuthorization()` records the authorize URL; the service layer
 *   owns the `connected`/`needs_reauth` transition.
 *
 * Log redaction: nothing here logs secret material (tokens/verifiers/URLs
 * with query strings); at most a fixed string.
 */
export class UpworkOAuthProvider implements OAuthClientProvider {
  private refreshPromise: Promise<StoredOAuthTokens | undefined> | null = null;

  constructor(
    private readonly deps: {
      store: UpworkConnectionStore;
      secret: string;
      redirectUri: string;
      clientName: string;
      /** Refresh proactively this many ms before `expires_at` (default 120s). */
      refreshBeforeExpiryMs?: number;
      now?: () => number;
      log?: (message: string) => void;
    },
  ) {}

  get redirectUrl(): string {
    return this.deps.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.deps.clientName,
      // Explicit: beats the SDK's loopback → native heuristic (this is a web app).
      application_type: 'web',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      redirect_uris: [this.deps.redirectUri],
    };
  }

  /**
   * CSRF state for the current authorization flow (reused if a flow is already
   * in progress — e.g. after a server restart mid-flow). Persisted immediately:
   * the callback compares the returned `state` against this exact value.
   */
  state(): string {
    const row = this.deps.store.get();
    if (row.flowState) return row.flowState;
    const fresh = randomBytes(24).toString('base64url');
    this.deps.store.set({ flowState: fresh });
    return fresh;
  }

  async clientInformation(
    ctx?: OAuthClientInformationContext,
  ): Promise<StoredOAuthClientInformation | undefined> {
    const row = this.deps.store.get();
    if (!row.clientInfoEnc || !row.issuer) return undefined;
    if (ctx && row.issuer !== ctx.issuer) return undefined;
    return decryptJson<StoredOAuthClientInformation>(this.deps.secret, row.clientInfoEnc);
  }

  async saveClientInformation(
    clientInformation: StoredOAuthClientInformation,
    ctx?: OAuthClientInformationContext,
  ): Promise<void> {
    const row = this.deps.store.get();
    this.deps.store.set({
      clientInfoEnc: encryptJson(this.deps.secret, clientInformation),
      issuer: ctx?.issuer ?? row.issuer,
    });
  }

  async tokens(ctx?: OAuthClientInformationContext): Promise<StoredOAuthTokens | undefined> {
    const row = this.deps.store.get();
    if (!row.tokensEnc || !row.issuer) return undefined;
    if (ctx && row.issuer !== ctx.issuer) return undefined;
    let tokens = decryptJson<StoredOAuthTokens>(this.deps.secret, row.tokensEnc);
    const window = this.deps.refreshBeforeExpiryMs ?? 120_000;
    const now = this.deps.now ?? Date.now;
    if (
      tokens.refresh_token &&
      row.accessExpiresAt !== null &&
      row.accessExpiresAt - now() < window
    ) {
      const fresh = await this.doRefreshOnce();
      if (fresh) tokens = fresh;
      // Refresh failed: return the stored set; the request may 401 and the SDK
      // will retry via its own refresh/redirect path.
    }
    return tokens;
  }

  async saveTokens(tokens: StoredOAuthTokens, ctx?: OAuthClientInformationContext): Promise<void> {
    const row = this.deps.store.get();
    const now = this.deps.now ?? Date.now;
    const expiresInMs =
      typeof tokens.expires_in === 'number' ? Math.max(0, Math.floor(tokens.expires_in * 1000)) : null;
    this.deps.store.set({
      tokensEnc: encryptJson(this.deps.secret, tokens),
      accessExpiresAt: expiresInMs === null ? null : now() + expiresInMs,
      issuer: ctx?.issuer ?? tokens.issuer ?? row.issuer,
    });
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.deps.store.set({ verifierEnc: encryptJson(this.deps.secret, codeVerifier) });
  }

  codeVerifier(): string {
    const row = this.deps.store.get();
    if (!row.verifierEnc) throw new Error('no code verifier stored');
    return decryptJson<string>(this.deps.secret, row.verifierEnc);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    const row = this.deps.store.get();
    this.deps.store.set({ pendingAuthorizeUrl: authorizationUrl.toString() });
    if (row.state === 'connected' || row.state === 'needs_reauth') {
      this.deps.store.set({ state: 'needs_reauth' });
    }
  }

  async saveDiscoveryState(state: OAuthDiscoveryState, ctx?: OAuthClientInformationContext): Promise<void> {
    const row = this.deps.store.get();
    this.deps.store.set({
      discoveryEnc: encryptJson(this.deps.secret, state),
      issuer: ctx?.issuer ?? row.issuer,
    });
  }

  async discoveryState(
    ctx?: OAuthClientInformationContext,
  ): Promise<OAuthDiscoveryState | undefined> {
    const row = this.deps.store.get();
    if (!row.discoveryEnc) return undefined;
    if (ctx && row.issuer && row.issuer !== ctx.issuer) return undefined;
    return decryptJson<OAuthDiscoveryState>(this.deps.secret, row.discoveryEnc);
  }

  /** Drop the credential classes the SDK says are no longer valid. */
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    const store = this.deps.store;
    if (scope === 'tokens') store.clearTokens();
    else if (scope === 'client') store.set({ clientInfoEnc: null });
    else if (scope === 'verifier') store.set({ verifierEnc: null });
    else if (scope === 'discovery') store.set({ discoveryEnc: null });
    else store.set({ tokensEnc: null, clientInfoEnc: null, verifierEnc: null, discoveryEnc: null });
  }

  /** Single-flight proactive refresh (SDK `refreshAuthorization` helper). */
  private async doRefreshOnce(): Promise<StoredOAuthTokens | undefined> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshTokens().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async refreshTokens(): Promise<StoredOAuthTokens | undefined> {
    const row = this.deps.store.get();
    if (!row.tokensEnc || !row.clientInfoEnc || !row.discoveryEnc || !row.issuer) return undefined;
    const tokens = decryptJson<StoredOAuthTokens>(this.deps.secret, row.tokensEnc);
    if (!tokens.refresh_token) return undefined;
    const clientInformation = decryptJson<StoredOAuthClientInformation>(
      this.deps.secret,
      row.clientInfoEnc,
    );
    const discovery = decryptJson<OAuthDiscoveryState>(this.deps.secret, row.discoveryEnc);
    try {
      const fresh = await refreshAuthorization(discovery.authorizationServerUrl, {
        metadata: discovery.authorizationServerMetadata,
        clientInformation,
        refreshToken: tokens.refresh_token,
        resource: discovery.resourceMetadata?.resource,
      });
      const merged: StoredOAuthTokens = { ...fresh, issuer: row.issuer };
      await this.saveTokens(merged, { issuer: row.issuer });
      const after = this.deps.store.get();
      return after.tokensEnc
        ? decryptJson<StoredOAuthTokens>(this.deps.secret, after.tokensEnc)
        : merged;
    } catch (err) {
      // Log without secret material: the SDK error may embed request details.
      this.deps.log?.('upwork token refresh failed');
      if (err instanceof Error) this.deps.log?.(err.message);
      return undefined;
    }
  }
}
