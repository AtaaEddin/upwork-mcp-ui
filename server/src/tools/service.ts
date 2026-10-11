import {
  ProtocolError,
  SdkError,
  SdkHttpError,
  UnauthorizedError,
  fromJsonSchema,
  type CallToolResult,
  type JsonSchemaType,
  type StandardSchemaWithJSON,
  type Tool,
} from '@modelcontextprotocol/client';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { UpworkConnectionService } from '../upwork/service.js';
import { hashArgs, type ToolCallLog } from './store.js';

/**
 * Tool proxy service (plan 04): the single front door to the Upwork MCP
 * server's tools. Guard rails:
 *  - only tools present in the live `tools/list` are callable (no raw
 *    JSON-RPC passthrough);
 *  - args validated against each tool's `inputSchema` (SDK-bundled ajv via
 *    `fromJsonSchema`);
 *  - per-call timeout (`MCP_TOOL_CALL_TIMEOUT_MS`);
 *  - single-flight per (tool, canonical args): concurrent duplicates share
 *    one upstream call; nothing is cached across time;
 *  - every MCP call runs through the connection service's single
 *    serialization queue — no parallel fan-out.
 */

export interface ToolServiceOptions {
  connection: UpworkConnectionService;
  /** Call log — the route records rows; the service never logs args. */
  log: ToolCallLog;
  config: AppConfig;
  /** Test overrides (default: config values). */
  callTimeoutMs?: number;
  toolsCacheTtlMs?: number;
  now?: () => number;
  logLine?: (message: string) => void;
}

export interface ToolsListResult {
  /** Tool objects pass-through from the server (name, description, inputSchema, ...). */
  tools: Tool[];
  count: number;
  /** Epoch ms the cached list was fetched. */
  fetchedAt: string;
}

export interface ToolCallOutcome {
  /** Result content parts pass-through (text / image / resource blocks). */
  content: unknown[];
  /** MCP tool-level failure (spec: tool errors are results, not RPC errors). */
  isError: boolean;
  structuredContent?: unknown;
  ms: number;
}

interface CacheEntry {
  tools: Tool[];
  fetchedAt: number;
  validators: Map<string, StandardSchemaWithJSON<unknown, unknown>>;
}

export class ToolService {
  private cache: CacheEntry | null = null;
  private readonly inflight = new Map<string, Promise<ToolCallOutcome>>();

  constructor(private readonly opts: ToolServiceOptions) {
    // Server-side list-changed notification → drop the cache (the SDK only
    // delivers this when the server advertises the capability).
    opts.connection.onToolsListChanged(() => {
      this.cache = null;
    });
  }

  private get callTimeoutMs(): number {
    return this.opts.callTimeoutMs ?? this.opts.config.MCP_TOOL_CALL_TIMEOUT_MS;
  }

  private get ttlMs(): number {
    return this.opts.toolsCacheTtlMs ?? this.opts.config.MCP_TOOLS_CACHE_TTL_MS;
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  /**
   * `tools/list`, TTL-cached in-process. `refresh: true` forces a re-fetch.
   * 409 while not connected — never served from cache across a drop.
   */
  async listTools(opts: { refresh?: boolean } = {}): Promise<ToolsListResult> {
    if (this.connectionState() !== 'connected') {
      throw new AppError('conflict', 'Not connected to Upwork. Connect (or reconnect) first.');
    }
    const now = this.now();
    if (!opts.refresh && this.cache && now - this.cache.fetchedAt < this.ttlMs) {
      return this.view();
    }
    const { tools } = await this.fetchToolsFromServer();
    this.cache = { tools, fetchedAt: this.now(), validators: this.compileValidators(tools) };
    return this.view();
  }

  private view(): ToolsListResult {
    const c = this.cache;
    if (!c) throw new AppError('internal_error', 'Tool list is not loaded');
    return { tools: c.tools, count: c.tools.length, fetchedAt: new Date(c.fetchedAt).toISOString() };
  }

  /**
   * `tools/call`. Validates the tool exists (404) and the args match its
   * inputSchema (400); maps upstream failures to safe AppErrors.
   * Returns 200-shaped results even when the tool reports `isError: true`
   * (MCP semantics — tool failure is a result, not a protocol error).
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome> {
    if (this.connectionState() !== 'connected') {
      throw new AppError('conflict', 'Not connected to Upwork. Connect (or reconnect) first.');
    }

    const list = await this.listTools();
    const tool = list.tools.find((t) => t.name === name);
    if (!tool) {
      throw new AppError('not_found', `Unknown tool: ${name}`);
    }

    const validator = this.cache?.validators.get(name);
    if (validator) {
      const problem = await validateArgs(validator, args);
      if (problem) throw new AppError('bad_request', problem);
    }

    const key = `${name}:${hashArgs(args)}`;
    const started = this.now();
    const inFlight = this.inflight.get(key);
    if (inFlight) return inFlight;
    const promise = this.doCall(name, args, started);
    this.inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }

  private connectionState(): string {
    return this.opts.connection.status().state;
  }

  private async doCall(
    name: string,
    args: Record<string, unknown>,
    started: number,
  ): Promise<ToolCallOutcome> {
    let result: CallToolResult;
    try {
      result = await this.opts.connection.withClient(
        (client) => client.callTool({ name, arguments: args }, { timeout: this.callTimeoutMs }),
      );
    } catch (err) {
      const mapped = this.mapMcpError(err);
      if (mapped) throw mapped;
      throw err;
    }
    const outcome: ToolCallOutcome = {
      content: result.content,
      isError: result.isError === true,
      ms: this.now() - started,
    };
    if (result.structuredContent !== undefined) outcome.structuredContent = result.structuredContent;
    return outcome;
  }

  private async fetchToolsFromServer(): Promise<{ tools: Tool[] }> {
    try {
      const res = await this.opts.connection.withClient((client) => client.listTools());
      return { tools: res.tools };
    } catch (err) {
      const mapped = this.mapMcpError(err);
      if (mapped) throw mapped;
      throw err;
    }
  }

  /**
   * Map MCP/SDK failures to safe AppErrors (never echoing upstream text —
   * it can carry PII). Returns null for errors this service does not own.
   */
  private mapMcpError(err: unknown): AppError | null {
    if (err instanceof AppError) return err;
    if (UnauthorizedError.isInstance(err)) {
      // The provider already flipped the connection state to `needs_reauth`.
      return new AppError('unauthorized', 'Upwork access denied. Re-authentication is required.');
    }
    if (SdkError.isInstance(err)) {
      if (err.code === 'REQUEST_TIMEOUT') {
        return new AppError('gateway_timeout', 'Upwork MCP did not respond in time. Try again.');
      }
      if (SdkHttpError.isInstance(err)) {
        if (err.status === 429) {
          const retryAfter = this.opts.connection.consumeRetryAfterSec() ?? 30;
          return new AppError('rate_limited', 'Upwork MCP rate limit reached. Wait before retrying.', retryAfter);
        }
        if (err.status === 401 || err.status === 403) {
          return new AppError('unauthorized', 'Upwork access denied. Re-authentication is required.');
        }
      }
      return new AppError('upstream_error', 'Upwork MCP request failed. Try again.');
    }
    if (ProtocolError.isInstance(err)) {
      return new AppError('upstream_error', 'Upwork MCP returned a protocol error.');
    }
    return null;
  }

  private compileValidators(tools: Tool[]): Map<string, StandardSchemaWithJSON<unknown, unknown>> {
    const map = new Map<string, StandardSchemaWithJSON<unknown, unknown>>();
    for (const tool of tools) {
      const schema = tool.inputSchema;
      if (!schema || typeof schema !== 'object' || Array.isArray(schema)) continue;
      try {
        // Wire JSON from the server, treated as a JSON Schema document.
        map.set(tool.name, fromJsonSchema(schema as unknown as JsonSchemaType));
      } catch (err) {
        // A malformed schema must not block the tool list: log and skip
        // validation for that tool.
        this.opts.logLine?.(`tools: skipping validator for ${tool.name} (${String(err)})`);
      }
    }
    return map;
  }
}

/** Validate args against a compiled standard-schema; returns a safe 400 message. */
async function validateArgs(schema: StandardSchemaWithJSON<unknown, unknown>, args: unknown): Promise<string | null> {
  const result = await schema['~standard'].validate(args);
  if (result.issues !== undefined) {
    const issues = result.issues
      .slice(0, 3)
      .map((issue) => {
        const path = (issue.path ?? [])
          .map((seg) => (typeof seg === 'object' && seg !== null ? String(seg.key) : String(seg)))
          .join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      });
    return `args do not match the tool's inputSchema — ${issues.join('; ')}`.slice(0, 500);
  }
  return null;
}
