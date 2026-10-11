import type { ApiError } from './api.js';

/**
 * Types + pure logic for the tools console (plan 04).
 * API contract: `GET /api/tools`, `POST /api/tools/:name/call`,
 * `GET /api/tools/calls` — all defined in the server (plan 04).
 */

/** Tool object pass-through from the Upwork MCP server via `GET /api/tools`. */
export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
  [key: string]: unknown;
}

export interface ToolsListResult {
  tools: ToolInfo[];
  count: number;
  /** ISO timestamp the server fetched the list. */
  fetchedAt: string;
}

export interface ToolCallOutcome {
  content: unknown[];
  isError: boolean;
  structuredContent?: unknown;
  ms: number;
}

export interface ToolCallRow {
  id: number;
  tool: string;
  /** sha256 of canonicalized args — args are never returned by the API. */
  argsHash: string;
  statusCode: number;
  ms: number;
  errorClass: string | null;
  createdAt: string;
}

export interface CallLogPage {
  items: ToolCallRow[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Derive a starter args object from `inputSchema`: every `required` property
 * gets a type-appropriate placeholder (string '', number 0, boolean false,
 * array [], object {}, otherwise null).
 */
export function buildArgsSkeleton(inputSchema: unknown): Record<string, unknown> {
  if (inputSchema === null || typeof inputSchema !== 'object') return {};
  const schema = inputSchema as Record<string, unknown>;
  const required = Array.isArray(schema.required) ? (schema.required as unknown[]) : [];
  const properties =
    schema.properties !== null && typeof schema.properties === 'object'
      ? (schema.properties as Record<string, unknown>)
      : null;
  const out: Record<string, unknown> = {};
  for (const key of required) {
    if (typeof key !== 'string') continue;
    out[key] = defaultValueFor(properties === null ? undefined : properties[key]);
  }
  return out;
}

function defaultValueFor(prop: unknown): unknown {
  if (prop === null || typeof prop !== 'object') return null;
  const t = (prop as Record<string, unknown>).type;
  switch (t) {
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return null;
  }
}

/** Concatenate `text` content parts for display (non-text parts ignored). */
export function extractText(content: unknown[]): string {
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      parts.push(part);
      continue;
    }
    if (part !== null && typeof part === 'object') {
      const p = part as Record<string, unknown>;
      if (p.type === 'text' && typeof p.text === 'string') parts.push(p.text);
    }
  }
  return parts.join('\n');
}

/** Human message for a failed tool call (keeps server-safe wording). */
export function toolCallErrorMessage(err: ApiError): string {
  switch (err.code) {
    case 'conflict':
      return 'Not connected to Upwork — connect (or reconnect) first.';
    case 'rate_limited':
      return `Upwork rate limit reached — retry in about ${err.retryAfterSec ?? 30}s.`;
    case 'unauthorized':
      return 'Upwork access denied — re-authentication is required (see the banner above).';
    case 'gateway_timeout':
      return 'Upwork MCP did not respond in time. Try again.';
    case 'not_found':
      return 'This tool is no longer offered by the Upwork MCP server. Refresh the list.';
    default:
      return err.message;
  }
}

/** curl command for the current tool + args (copy-as-curl). */
export function buildCurlCommand(name: string, args: Record<string, unknown>, origin: string): string {
  return `curl -X POST ${origin}/api/tools/${encodeURIComponent(name)}/call -H 'content-type: application/json' -d '${JSON.stringify({ args })}'`;
}
