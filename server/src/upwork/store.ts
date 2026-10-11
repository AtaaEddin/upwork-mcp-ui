import type { Statement } from 'better-sqlite3';
import type { Db } from '../db.js';
import { decryptJson, encryptJson } from './crypto.js';

export type UpworkState = 'disconnected' | 'connecting' | 'connected' | 'needs_reauth';

/**
 * One persisted row per deployment (single-owner app): the whole Upwork
 * connection state — machine state, OAuth credentials, in-flight flow
 * material. Everything sensitive is AES-256-GCM encrypted at rest.
 */
export interface ConnectionRow {
  id: number;
  state: UpworkState;
  issuer: string | null;
  /** Epoch ms of access-token expiry (derived from `expires_in` when tokens are saved). */
  accessExpiresAt: number | null;
  /** AES-256-GCM blob: StoredOAuthTokens (SDK shape + issuer). */
  tokensEnc: string | null;
  /** AES-256-GCM blob: OAuthClientInformationMixed (DCR result). */
  clientInfoEnc: string | null;
  /** AES-256-GCM blob: PKCE code verifier of the current/last flow. */
  verifierEnc: string | null;
  /** AES-256-GCM blob: OAuthDiscoveryState (authorization server metadata). */
  discoveryEnc: string | null;
  /** CSRF `state` for the current authorization flow. */
  flowState: string | null;
  /** Authorize URL recorded when the SDK asked us to redirect the user. */
  pendingAuthorizeUrl: string | null;
  connectedAt: number | null;
}

type RowPatch = Partial<
  Pick<
    ConnectionRow,
    | 'state'
    | 'issuer'
    | 'accessExpiresAt'
    | 'tokensEnc'
    | 'clientInfoEnc'
    | 'verifierEnc'
    | 'discoveryEnc'
    | 'flowState'
    | 'pendingAuthorizeUrl'
    | 'connectedAt'
  >
>;

export class UpworkConnectionStore {
  private readonly upsertStmt: Statement;
  private readonly selectStmt: Statement;

  constructor(
    private readonly db: Db,
  ) {
    this.selectStmt = db.prepare('SELECT * FROM upwork_connection WHERE id = 1');
    this.upsertStmt = db.prepare(
      `INSERT INTO upwork_connection (id, state) VALUES (1, 'disconnected')
       ON CONFLICT(id) DO UPDATE SET id = excluded.id`,
    );
  }

  /** Read the row (created on first use) and decrypt the secrets. */
  get(): ConnectionRow {
    let row = this.selectStmt.get() as Row | undefined;
    if (!row) {
      this.upsertStmt.run();
      row = this.selectStmt.get() as Row | undefined;
      if (!row) throw new Error('upwork_connection row missing');
    }
    return toConnectionRow(row);
  }

  set(patch: RowPatch): void {
    const assignments: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, value: unknown): void => {
      if (value === undefined) return;
      assignments.push(`${col} = ?`);
      params.push(value);
    };
    add('state', patch.state);
    add('issuer', patch.issuer);
    add('access_expires_at', patch.accessExpiresAt);
    add('tokens_enc', patch.tokensEnc);
    add('client_info_enc', patch.clientInfoEnc);
    add('verifier_enc', patch.verifierEnc);
    add('discovery_enc', patch.discoveryEnc);
    add('flow_state', patch.flowState);
    add('pending_authorize_url', patch.pendingAuthorizeUrl);
    add('connected_at', patch.connectedAt);
    if (assignments.length === 0) return;
    assignments.push('updated_at = ?');
    params.push(nowMs());
    this.db
      .prepare(`UPDATE upwork_connection SET ${assignments.join(', ')} WHERE id = 1`)
      .run(...params);
  }

  /** Drop in-flight flow material (state token + pending redirect). */
  clearFlow(): void {
    this.db
      .prepare(
        'UPDATE upwork_connection SET flow_state = NULL, pending_authorize_url = NULL, updated_at = ? WHERE id = 1',
      )
      .run(nowMs());
  }

  /** Drop tokens + PKCE verifier + expiry (keep DCR client info + discovery state). */
  clearTokens(): void {
    this.db
      .prepare(
        'UPDATE upwork_connection SET tokens_enc = NULL, verifier_enc = NULL, access_expires_at = NULL, connected_at = NULL, updated_at = ? WHERE id = 1',
      )
      .run(nowMs());
  }

  /** Drop everything (mix-up / security events). Resets state to disconnected. */
  clearAll(): void {
    this.db
      .prepare(
        `UPDATE upwork_connection
         SET state = 'disconnected', issuer = NULL, access_expires_at = NULL,
             tokens_enc = NULL, client_info_enc = NULL, verifier_enc = NULL,
             discovery_enc = NULL, flow_state = NULL, pending_authorize_url = NULL,
             connected_at = NULL, updated_at = ?
         WHERE id = 1`,
      )
      .run(nowMs());
  }
}

interface Row {
  id: number;
  state: string;
  issuer: string | null;
  access_expires_at: number | null;
  tokens_enc: string | null;
  client_info_enc: string | null;
  verifier_enc: string | null;
  discovery_enc: string | null;
  flow_state: string | null;
  pending_authorize_url: string | null;
  connected_at: number | null;
}

function toConnectionRow(row: Row): ConnectionRow {
  return {
    id: row.id,
    state: row.state as UpworkState,
    issuer: row.issuer,
    accessExpiresAt: row.access_expires_at,
    tokensEnc: row.tokens_enc,
    clientInfoEnc: row.client_info_enc,
    verifierEnc: row.verifier_enc,
    discoveryEnc: row.discovery_enc,
    flowState: row.flow_state,
    pendingAuthorizeUrl: row.pending_authorize_url,
    connectedAt: row.connected_at,
  };
}

/** Decrypt helper for callers that need the typed payload (service tests). */
export function decryptBlob<T>(secret: string, blob: string | null): T | null {
  if (!blob) return null;
  return decryptJson<T>(secret, blob);
}

/** Encrypt helper (mirrors {@link decryptBlob}). */
export function encryptBlob(secret: string, value: unknown): string {
  return encryptJson(secret, value);
}

function nowMs(): number {
  return Date.now();
}
