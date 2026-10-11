import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { fetchMock, jsonResponse, type FetchRoute } from '../test/fetchMock.js';
import { ToolsPage } from './ToolsPage.js';

const TOOLS = [
  {
    name: 'upwork__get_account',
    description: 'Account details',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: { action: { type: 'string' }, limit: { type: 'number' } },
    },
  },
  {
    name: 'upwork__list_jobs',
    description: 'List jobs',
    inputSchema: { type: 'object' },
  },
];

const RECENT_ROW = {
  id: 7,
  tool: 'upwork__get_account',
  argsHash: 'ab12cd34'.repeat(8),
  statusCode: 200,
  ms: 12,
  errorClass: null,
  createdAt: '2026-10-11T12:00:00.000Z',
};

function renderPage(fetchImpl: ReturnType<typeof fetchMock>) {
  vi.stubGlobal('fetch', fetchImpl);
  return render(
    <MemoryRouter initialEntries={['/tools']}>
      <Routes>
        <Route path="/tools" element={<ToolsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function defaultRoutes(): Record<string, FetchRoute> {
  return {
    '/api/upwork/status': () => jsonResponse({ state: 'connected' }),
    '/api/tools': () => jsonResponse({ tools: TOOLS, count: TOOLS.length, fetchedAt: '2026-10-11T00:00:00.000Z' }),
    '/api/tools/calls': () => jsonResponse({ items: [RECENT_ROW], limit: 10, offset: 0, hasMore: false }),
  };
}

function connectedFetch(): ReturnType<typeof fetchMock> {
  return fetchMock(defaultRoutes());
}

describe('ToolsPage', () => {
  it('lists tools and selects the first one when connected', async () => {
    renderPage(connectedFetch());

    await screen.findAllByText('upwork__get_account');
    expect(screen.getAllByText('upwork__get_account').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('upwork__list_jobs')).toBeInTheDocument();
    expect(screen.getByText(/2 tools/)).toBeInTheDocument();
    // Recent calls table renders from GET /api/tools/calls
    expect(screen.getByText('Recent calls')).toBeInTheDocument();
    expect(screen.getAllByText('upwork__get_account').length).toBeGreaterThanOrEqual(3);
  });

  it('filters tools by search query', async () => {
    renderPage(connectedFetch());
    await screen.findByText('upwork__list_jobs');

    const search = screen.getByPlaceholderText(/filter by name/i);
    fireEvent.change(search, { target: { value: 'zzz-no-match' } });
    expect(await screen.findByText(/no tools match/i)).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'list_jobs' } });
    expect(await screen.findByText('upwork__list_jobs')).toBeInTheDocument();
    const toolButtons = screen
      .getAllByRole('button')
      .filter((b) => b.textContent?.includes('upwork__'));
    expect(toolButtons).toHaveLength(1);
  });

  it('calls a tool, shows the result, and records the row', async () => {
    const fetchImpl = fetchMock({
      ...defaultRoutes(),
      '/api/tools/upwork__get_account/call': (req) =>
        req.method === 'POST'
          ? jsonResponse({ content: [{ type: 'text', text: 'hello from tool' }], isError: false, ms: 12 })
          : jsonResponse({ error: { code: 'method_not_allowed', message: 'no' } }, 405),
    });
    renderPage(fetchImpl);
    await screen.findAllByText('upwork__get_account');

    // Wait for the args skeleton (derived from inputSchema) to render.
    const argsBox = screen.getByRole('textbox') as HTMLTextAreaElement;
    await waitFor(() => expect(JSON.parse(argsBox.value)).toEqual({ action: '' }));

    fireEvent.click(screen.getByRole('button', { name: 'Call tool' }));

    expect(await screen.findByText('hello from tool')).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();

    const post = fetchImpl.mock.calls.find((c) => String(c[0]).endsWith('/api/tools/upwork__get_account/call'));
    expect(post).toBeDefined();
    const body = JSON.parse(String(post?.[1]?.body)) as { args: Record<string, unknown> };
    // Skeleton derived from inputSchema required[]: action → ''
    expect(body).toEqual({ args: { action: '' } });

    // Recent tail refreshed after the call.
    await waitFor(() =>
      expect(screen.getAllByText('upwork__get_account').length).toBeGreaterThanOrEqual(3),
    );
  });

  it('shows a 400 validation error from the server', async () => {
    const fetchImpl = fetchMock({
      ...defaultRoutes(),
      '/api/tools/upwork__get_account/call': (req) =>
        req.method === 'POST'
          ? jsonResponse({ error: { code: 'bad_request', message: 'args.action is required' } }, 400)
          : jsonResponse({ error: { code: 'method_not_allowed', message: 'no' } }, 405),
    });
    renderPage(fetchImpl);
    await screen.findAllByText('upwork__get_account');

    fireEvent.click(screen.getByRole('button', { name: 'Call tool' }));
    expect(await screen.findByText(/args\.action is required/i)).toBeInTheDocument();
  });

  it('shows a 429 rate-limit error with retry time', async () => {
    const fetchImpl = fetchMock({
      ...defaultRoutes(),
      '/api/tools/upwork__get_account/call': (req) =>
        req.method === 'POST'
          ? jsonResponse({ error: { code: 'rate_limited', message: 'retry later' } }, 429, {
              'retry-after': '30',
            })
          : jsonResponse({ error: { code: 'method_not_allowed', message: 'no' } }, 405),
    });
    renderPage(fetchImpl);
    await screen.findAllByText('upwork__get_account');

    fireEvent.click(screen.getByRole('button', { name: 'Call tool' }));
    expect(await screen.findByText(/rate limit.*about 30s/i)).toBeInTheDocument();
  });

  it('shows the connect CTA when not connected (no tools fetch)', async () => {
    const fetchImpl = fetchMock({
      '/api/upwork/status': () => jsonResponse({ state: 'disconnected' }),
    });
    renderPage(fetchImpl);

    expect(await screen.findByRole('button', { name: /connect to upwork/i })).toBeInTheDocument();
    await waitFor(() => {
      const toolsCalls = fetchImpl.mock.calls.filter((c) => String(c[0]).startsWith('/api/tools'));
      expect(toolsCalls).toHaveLength(0);
    });
  });

  it('surfaces the 409 (not connected) list error when status flips mid-page', async () => {
    let connected = true;
    const fetchImpl = fetchMock({
      '/api/upwork/status': () => jsonResponse({ state: connected ? 'connected' : 'disconnected' }),
      '/api/tools': () =>
        connected
          ? jsonResponse({ tools: TOOLS, count: 2, fetchedAt: '2026-10-11T00:00:00.000Z' })
          : jsonResponse({ error: { code: 'conflict', message: 'not connected' } }, 409),
      '/api/tools/calls': () => jsonResponse({ items: [], limit: 10, offset: 0, hasMore: false }),
    });
    renderPage(fetchImpl);
    await screen.findAllByText('upwork__get_account');

    connected = false;
    fireEvent.click(screen.getByRole('button', { name: /refresh list/i }));
    expect(await screen.findByText(/not connected to upwork/i)).toBeInTheDocument();
  });
});
