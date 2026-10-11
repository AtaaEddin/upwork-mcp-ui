import { createHash } from 'node:crypto';
import type { Statement } from 'better-sqlite3';
import type { Db } from '../db.js';

export interface ToolCallRow {
  id: number;
  tool: string;
  /** sha256 of canonicalized args — args themselves are never stored. */
  argsHash: string;
  statusCode: number;
  ms: number;
  errorClass: string | null;
  createdAt: string;
}

interface LogEntry {
  tool: string;
  argsHash: string;
  statusCode: number;
  ms: number;
  errorClass?: string;
}

/**
 * Deterministic canonical JSON: object keys sorted, arrays in order,
 * undefined-valued object entries dropped (same as `JSON.stringify`).
 * Used for both the args hash and the single-flight key.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value);
    return s === undefined ? 'null' : s;
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** PII-safe log key: sha256 of canonical args (never the args themselves). */
export function hashArgs(args: unknown): string {
  return createHash('sha256').update(canonicalJson(args)).digest('hex');
}

interface Row {
  id: number;
  tool: string;
  args_hash: string;
  status_code: number;
  ms: number;
  error_class: string | null;
  created_at: string;
}

/**
 * SQLite-backed tool-call log (plan 04, migration 003). Redaction is
 * structural: entries carry only the args hash, so PII in args can never
 * reach a log row.
 */
export class ToolCallLog {
  private readonly insertStmt: Statement;
  private readonly selectStmt: Statement;

  constructor(db: Db) {
    this.insertStmt = db.prepare(
      `INSERT INTO tool_calls (tool, args_hash, status_code, ms, error_class)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.selectStmt = db.prepare(
      `SELECT id, tool, args_hash, status_code, ms, error_class, created_at
       FROM tool_calls ORDER BY id DESC LIMIT ? OFFSET ?`,
    );
  }

  record(entry: LogEntry): void {
    this.insertStmt.run(
      entry.tool,
      entry.argsHash,
      entry.statusCode,
      entry.ms,
      entry.errorClass ?? null,
    );
  }

  /** Newest first; `hasMore` reports whether another page exists. */
  recent(limit: number, offset: number): { items: ToolCallRow[]; hasMore: boolean } {
    const rows = this.selectStmt.all(limit + 1, offset) as Row[];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => ({
      id: r.id,
      tool: r.tool,
      argsHash: r.args_hash,
      statusCode: r.status_code,
      ms: r.ms,
      errorClass: r.error_class,
      createdAt: r.created_at,
    }));
    return { items, hasMore };
  }
}
