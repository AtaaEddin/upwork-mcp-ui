import type { Db } from '../db.js';
import { AppError } from '../errors.js';
import type { UpworkConnectionService } from './service.js';

/** One Upwork account as returned by `upwork__list_accounts`. */
export interface UpworkAccount {
  orgUid: string;
  name: string;
  /** Raw role code as returned by Upwork ('CLIENT' | 'TALENT' | 'FL_AGENCY' | …). */
  role: string;
  roleLabel: string;
  suspended: boolean;
}

export interface AccountSelectionView {
  account: UpworkAccount | null;
  /** Every listed account (only the stored selection itself for `source: 'stored'`). */
  accounts: UpworkAccount[];
  source: 'stored' | 'bootstrapped' | 'none';
}

/**
 * Tool name of the account list. Documented by the official plugin
 * (`upwork/upwork-agent-plugin`) and observed in the 2026-09-02 live
 * inspection (33 tools, `upwork__` prefix) — pending the discovery log.
 */
const LIST_ACCOUNTS_TOOL = 'upwork__list_accounts';

/**
 * Selected-account persistence (plan 06): `org_uid` must be passed on every
 * tool call after `list_accounts`, so the app remembers which account the
 * owner picked. Single row (id = 1), cleared on disconnect.
 */
class UpworkAccountStore {
  constructor(private readonly db: Db) {}

  get(): UpworkAccount | null {
    const row = this.db
      .prepare('SELECT * FROM upwork_account WHERE id = 1')
      .get() as Row | undefined;
    return row ? toAccount(row) : null;
  }

  set(account: UpworkAccount): void {
    this.db
      .prepare(
        `INSERT INTO upwork_account (id, org_uid, name, role, role_label, suspended)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           org_uid = excluded.org_uid,
           name = excluded.name,
           role = excluded.role,
           role_label = excluded.role_label,
           suspended = excluded.suspended,
           updated_at = unixepoch() * 1000`,
      )
      .run(account.orgUid, account.name, account.role, account.roleLabel, account.suspended ? 1 : 0);
  }

  clear(): void {
    this.db.prepare('DELETE FROM upwork_account WHERE id = 1').run();
  }
}

interface Row {
  org_uid: string;
  name: string;
  role: string;
  role_label: string | null;
  suspended: number;
}

function toAccount(row: Row): UpworkAccount {
  return {
    orgUid: row.org_uid,
    name: row.name,
    role: row.role,
    roleLabel: row.role_label ?? '',
    suspended: row.suspended === 1,
  };
}

export interface UpworkAccountServiceOptions {
  connection: UpworkConnectionService;
  db: Db;
}

/**
 * Account selection service (plan 06). Server-internal bootstrap: it calls
 * `upwork__list_accounts` through the connection's serialized queue (the
 * same single queue as all MCP traffic — no parallel fan-out), not through
 * the generic tool API, so internal bootstraps do not pollute the
 * console's recent-calls log.
 *
 * Error mapping (plan-02 envelope):
 * - AppError('conflict')    — select while not connected
 * - AppError('bad_request') — unknown orgUid
 * (upstream failures keep their ToolService-style mapping via withClient)
 */
export class UpworkAccountService {
  private readonly store: UpworkAccountStore;

  constructor(private readonly opts: UpworkAccountServiceOptions) {
    this.store = new UpworkAccountStore(opts.db);
  }

  /**
   * Return the selection. Not connected ⇒ `{account: null}` (the client then
   * shows its connect state). Connected with a stored selection ⇒ served
   * from the DB (no upstream call). Otherwise bootstraps once from
   * `list_accounts`; `refresh: true` forces the upstream list.
   */
  async get(opts: { refresh?: boolean } = {}): Promise<AccountSelectionView> {
    if (this.opts.connection.status().state !== 'connected') {
      return { account: null, accounts: [], source: 'none' };
    }
    if (!opts.refresh) {
      const stored = this.store.get();
      if (stored) return { account: stored, accounts: [stored], source: 'stored' };
    }
    const accounts = await this.listAccounts();
    const account = pickAccount(accounts);
    if (account) this.store.set(account);
    else this.store.clear();
    return { account, accounts, source: 'bootstrapped' };
  }

  /**
   * Store a manual selection (multi-account owners). Re-lists upstream and
   * validates membership — never trust a client-supplied orgUid blindly.
   */
  async select(orgUid: string): Promise<UpworkAccount> {
    if (this.opts.connection.status().state !== 'connected') {
      throw new AppError('conflict', 'Not connected to Upwork. Connect (or reconnect) first.');
    }
    const accounts = await this.listAccounts();
    const account = accounts.find((a) => a.orgUid === orgUid);
    if (!account) {
      throw new AppError(
        'bad_request',
        'Unknown account — pick one of the accounts the Upwork MCP server lists.',
      );
    }
    this.store.set(account);
    return account;
  }

  /** Drop the selection (called on disconnect). */
  clear(): void {
    this.store.clear();
  }

  private async listAccounts(): Promise<UpworkAccount[]> {
    const outcome = await this.opts.connection.withClient((client) =>
      client.callTool({ name: LIST_ACCOUNTS_TOOL, arguments: {} }),
    );
    return parseUpworkAccounts(outcome);
  }
}

/**
 * Pick the account to bootstrap with: this is a freelancer-side app, so
 * prefer a non-suspended `TALENT` account, then `FL_AGENCY`, then any
 * non-suspended account (the owner can still switch via PUT /account).
 */
export function pickAccount(accounts: UpworkAccount[]): UpworkAccount | null {
  const eligible = accounts.filter((a) => !a.suspended);
  const pool = eligible.length > 0 ? eligible : accounts;
  const talent = pool.find((a) => a.role === 'TALENT');
  if (talent) return talent;
  const agency = pool.find((a) => a.role === 'FL_AGENCY');
  if (agency) return agency;
  return pool[0] ?? null;
}

/**
 * Defensive parser for `upwork__list_accounts` results. Accepts
 * structuredContent, or a text part carrying JSON; the account array may be
 * top-level or nested (accounts/items/data/list).
 */
export function parseUpworkAccounts(outcome: {
  content: unknown[];
  structuredContent?: unknown;
}): UpworkAccount[] {
  const data = extractPayload(outcome);
  const out: UpworkAccount[] = [];
  for (const item of findArray(data)) {
    if (item === null || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const orgUid = stringOf(rec.org_uid ?? rec.orgUid);
    if (orgUid === null) continue;
    out.push({
      orgUid,
      name: stringOf(rec.name) ?? '',
      role: stringOf(rec.role) ?? '',
      roleLabel: stringOf(rec.role_label ?? rec.roleLabel) ?? '',
      suspended: rec.suspended === true,
    });
  }
  return out;
}

function stringOf(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function extractPayload(outcome: {
  content: unknown[];
  structuredContent?: unknown;
}): unknown {
  const sc = outcome.structuredContent;
  if (sc !== null && typeof sc === 'object') return sc;
  for (const part of outcome.content) {
    if (part === null || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    if (p.type !== 'text' || typeof p.text !== 'string') continue;
    const text = (p.text as string).trim();
    if (text === '' || (!text.startsWith('{') && !text.startsWith('['))) continue;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      continue;
    }
  }
  return null;
}

function findArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data !== null && typeof data === 'object') {
    const rec = data as Record<string, unknown>;
    for (const key of ['accounts', 'items', 'data', 'list', 'results']) {
      const v = rec[key];
      if (Array.isArray(v)) return v;
    }
    for (const v of Object.values(rec)) {
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}
