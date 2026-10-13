import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NotConnectedCta } from '../components/NotConnectedCta.js';
import { apiFetch, ApiError } from '../lib/api.js';
import { useUpworkStatus } from '../hooks/useUpworkStatus.js';
import {
  buildArgsSkeleton,
  buildCurlCommand,
  extractText,
  toolCallErrorMessage,
  type CallLogPage,
  type ToolCallOutcome,
  type ToolsListResult,
} from '../lib/tools.js';

type CallState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'done'; outcome: ToolCallOutcome }
  | { kind: 'error'; message: string };

/**
 * Tools console (plan 04): every tool the Upwork MCP server exposes —
 * searchable list, JSON args editor, live call, result viewer, copy-as-curl,
 * recent call log. Read-only console: it calls tools, never binds actions.
 */
export function ToolsPage() {
  const { status, refresh: refreshStatus } = useUpworkStatus();
  const connected = status.state === 'connected';

  const [tools, setTools] = useState<ToolsListResult | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [argsText, setArgsText] = useState('{}');
  const [callState, setCallState] = useState<CallState>({ kind: 'idle' });
  const [recent, setRecent] = useState<CallLogPage | null>(null);
  const [copied, setCopied] = useState(false);
  const lastSelected = useRef<string | null>(null);
  const copyTimer = useRef<number | null>(null);

  const loadRecent = useCallback(async (): Promise<void> => {
    try {
      const page = await apiFetch<CallLogPage>('/api/tools/calls?limit=10');
      setRecent(page);
    } catch {
      // Recent log is decorative — ignore (the table simply stays empty).
      setRecent(null);
    }
  }, []);

  const loadTools = useCallback(
    async (force: boolean): Promise<void> => {
      setListLoading(true);
      setListError(null);
      try {
        const res = await apiFetch<ToolsListResult>(force ? '/api/tools?refresh=1' : '/api/tools');
        setTools(res);
      } catch (err) {
        setListError(err instanceof ApiError ? toolCallErrorMessage(err) : 'Could not load tools.');
      } finally {
        setListLoading(false);
      }
    },
    [],
  );

  // Fetch the list once the Upwork connection is established (plan 04:
  // tools are served only when connected).
  useEffect(() => {
    if (connected) {
      void loadTools(false);
      void loadRecent();
    }
  }, [connected, loadTools, loadRecent]);

  // Auto-select the first tool (re-select when the list changes under us).
  useEffect(() => {
    if (tools === null) return;
    if (selected === null || tools.tools.every((t) => t.name !== selected)) {
      setSelected(tools.tools[0]?.name ?? null);
    }
  }, [tools, selected]);

  // Reset the args editor + result when a different tool is selected.
  useEffect(() => {
    if (selected === lastSelected.current) return;
    lastSelected.current = selected;
    const tool = tools?.tools.find((t) => t.name === selected) ?? null;
    setArgsText(JSON.stringify(buildArgsSkeleton(tool?.inputSchema), null, 2));
    setCallState({ kind: 'idle' });
  }, [selected, tools]);

  const selectedTool = tools?.tools.find((t) => t.name === selected) ?? null;

  const filtered = useMemo(() => {
    if (tools === null) return [];
    const q = query.trim().toLowerCase();
    if (q === '') return tools.tools;
    return tools.tools.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q),
    );
  }, [tools, query]);

  const argsForCurl = useMemo<Record<string, unknown>>(() => {
    try {
      const parsed: unknown = JSON.parse(argsText);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }, [argsText]);

  const curlCommand = selectedTool === null ? null : buildCurlCommand(selectedTool.name, argsForCurl, window.location.origin);

  const handleCall = useCallback(async (): Promise<void> => {
    if (selectedTool === null) return;
    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(argsText);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('args must be a JSON object');
      }
      args = parsed as Record<string, unknown>;
    } catch {
      setCallState({ kind: 'error', message: 'Args must be a valid JSON object (e.g. {}). Try again.' });
      return;
    }
    setCallState({ kind: 'pending' });
    try {
      const outcome = await apiFetch<ToolCallOutcome>(
        `/api/tools/${encodeURIComponent(selectedTool.name)}/call`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ args }),
        },
      );
      setCallState({ kind: 'done', outcome });
    } catch (err) {
      if (err instanceof ApiError) {
        setCallState({ kind: 'error', message: toolCallErrorMessage(err) });
        if (err.status === 409) void refreshStatus();
      } else {
        setCallState({ kind: 'error', message: 'Unexpected error while calling the tool.' });
      }
    } finally {
      // The server logs every attempt (success or error) — refresh the tail.
      void loadRecent();
    }
  }, [selectedTool, argsText, loadRecent, refreshStatus]);

  const handleCopyCurl = useCallback(async (): Promise<void> => {
    if (curlCommand === null) return;
    try {
      await navigator.clipboard.writeText(curlCommand);
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions/insecure context) — no-op.
    }
  }, [curlCommand]);

  if (connected === false) {
    return <NotConnectedCta title="Tools console" state={status.state} />;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-up-black dark:text-white">Tools console</h1>
          <p className="mt-1 text-sm text-up-black/60 dark:text-white/60">
            Every tool the Upwork MCP server exposes. Calls are logged (args are hashed, never stored).
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {tools !== null && (
            <span className="text-xs text-up-black/50 dark:text-white/50">
              {`${tools.count} tools · fetched ${new Date(tools.fetchedAt).toLocaleTimeString()}`}
            </span>
          )}
          <button
            type="button"
            onClick={() => void loadTools(true)}
            disabled={listLoading}
            className="rounded-md border border-up-border bg-white px-3 py-1.5 text-xs font-semibold text-up-teal transition-colors hover:bg-up-surface-2 disabled:opacity-50 dark:border-white/15 dark:bg-white/5 dark:text-up-lime dark:hover:bg-white/10"
          >
            {listLoading ? 'Refreshing…' : 'Refresh list'}
          </button>
        </div>
      </header>

      {listError !== null && (
        <div role="alert" className="rounded-lg border border-up-red/30 bg-up-red/5 px-4 py-3 text-sm text-up-red">
          {listError}
        </div>
      )}

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
          Search
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name or description…"
          className="mt-1 w-full rounded-md border border-up-border bg-white px-3 py-2 text-sm text-up-black outline-none focus:border-up-green dark:border-white/15 dark:bg-up-black dark:text-white dark:focus:border-up-green"
        />
      </label>

      {tools !== null && (
        <ul className="divide-y divide-up-border overflow-hidden rounded-lg border border-up-border bg-white dark:divide-white/10 dark:border-white/15 dark:bg-white/5">
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-sm text-up-black/60 dark:text-white/60">
              No tools match “{query.trim()}”.
            </li>
          )}
          {filtered.map((t) => (
            <li key={t.name}>
              <button
                type="button"
                onClick={() => setSelected(t.name)}
                className={`block w-full px-4 py-3 text-left transition-colors ${
                  t.name === selected
                    ? 'bg-up-surface-2 dark:bg-white/10'
                    : 'hover:bg-up-surface dark:hover:bg-white/5'
                }`}
              >
                <span className="block font-mono text-sm font-medium text-up-black dark:text-white">{t.name}</span>
                {t.description !== undefined && (
                  <span className="mt-0.5 block text-xs text-up-black/60 dark:text-white/60">
                    {t.description}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedTool !== null && (
        <section className="rounded-lg border border-up-border bg-white p-4 dark:border-white/15 dark:bg-white/5">
          <h2 className="font-mono text-sm font-semibold text-up-black dark:text-white">
            {selectedTool.name}
          </h2>
          {selectedTool.description !== undefined && (
            <p className="mt-2 text-sm text-up-black/70 dark:text-white/70">{selectedTool.description}</p>
          )}

          {selectedTool.inputSchema !== undefined && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-up-teal dark:text-up-lime">
                Input schema
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-md bg-up-surface p-3 text-xs text-up-black dark:bg-up-black dark:text-white">
                {JSON.stringify(selectedTool.inputSchema, null, 2)}
              </pre>
            </details>
          )}

          <label className="mt-4 block">
            <span className="text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
              Args (JSON)
            </span>
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              rows={6}
              spellCheck={false}
              className="mt-1 w-full rounded-md border border-up-border bg-white px-3 py-2 font-mono text-xs text-up-black outline-none focus:border-up-green dark:border-white/15 dark:bg-up-black dark:text-white dark:focus:border-up-green"
            />
          </label>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCall()}
              disabled={callState.kind === 'pending'}
              className="rounded-md bg-up-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-up-green-dark disabled:opacity-50"
            >
              {callState.kind === 'pending' ? 'Calling…' : 'Call tool'}
            </button>
            <button
              type="button"
              onClick={() => void handleCopyCurl()}
              className="rounded-md border border-up-border bg-white px-3 py-2 text-xs font-semibold text-up-teal transition-colors hover:bg-up-surface-2 dark:border-white/15 dark:bg-white/5 dark:text-up-lime dark:hover:bg-white/10"
            >
              {copied ? 'Copied!' : 'Copy as curl'}
            </button>
          </div>

          {callState.kind === 'done' && (
            <div className="mt-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    callState.outcome.isError
                      ? 'bg-up-red/10 text-up-red'
                      : 'bg-up-green/10 text-up-green-hc dark:text-up-lime'
                  }`}
                >
                  {callState.outcome.isError ? 'Tool reported an error' : 'Success'}
                </span>
                <span className="text-xs text-up-black/50 dark:text-white/50">{callState.outcome.ms} ms</span>
              </div>
              {extractText(callState.outcome.content) !== '' ? (
                <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-up-surface p-3 text-xs whitespace-pre-wrap text-up-black dark:bg-up-black dark:text-white">
                  {extractText(callState.outcome.content)}
                </pre>
              ) : (
                <p className="mt-2 text-xs text-up-black/50 dark:text-white/50">(no text content in result)</p>
              )}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-semibold text-up-teal dark:text-up-lime">
                  Raw result JSON
                </summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-up-surface p-3 text-xs text-up-black dark:bg-up-black dark:text-white">
                  {JSON.stringify(callState.outcome, null, 2)}
                </pre>
              </details>
            </div>
          )}

          {callState.kind === 'error' && (
            <p role="alert" className="mt-4 text-sm font-medium text-up-red">
              {callState.message}
            </p>
          )}
        </section>
      )}

      {recent !== null && recent.items.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-up-black/50 dark:text-white/50">
            Recent calls
          </h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-up-border bg-white dark:border-white/15 dark:bg-white/5">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-up-border text-xs text-up-black/50 dark:border-white/10 dark:text-white/50">
                  <th className="px-4 py-2 font-semibold">Tool</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">ms</th>
                  <th className="px-4 py-2 font-semibold">When</th>
                </tr>
              </thead>
              <tbody>
                {recent.items.map((row) => (
                  <tr key={row.id} className="border-b border-up-border last:border-0 dark:border-white/10">
                    <td className="px-4 py-2 font-mono text-xs text-up-black dark:text-white">{row.tool}</td>
                    <td className="px-4 py-2 text-xs">
                      {row.statusCode === 200 ? (
                        <span className="font-semibold text-up-green-hc dark:text-up-lime">200</span>
                      ) : (
                        <span className="font-semibold text-up-red">{row.statusCode}</span>
                      )}
                      {row.errorClass !== null && (
                        <span className="ml-1 text-up-black/50 dark:text-white/50">{row.errorClass}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-up-black/70 dark:text-white/70">{row.ms}</td>
                    <td className="px-4 py-2 text-xs text-up-black/70 dark:text-white/70">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
