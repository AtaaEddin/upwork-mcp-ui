import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { fetchMock, jsonResponse, type FetchRoute } from '../test/fetchMock.js';
import { AccountProvider } from '../context/account.js';
import { DashboardPage } from './DashboardPage.js';

const LIVE_TOOLS = [
  { name: 'upwork__find_jobs', description: 'Find jobs', inputSchema: { type: 'object' } },
  { name: 'upwork__list_freelancer_proposals', description: 'Proposals', inputSchema: { type: 'object' } },
  { name: 'upwork__list_offers', description: 'Offers', inputSchema: { type: 'object' } },
  { name: 'upwork__get_messages', description: 'Messages', inputSchema: { type: 'object' } },
  { name: 'upwork__get_profile', description: 'Profile', inputSchema: { type: 'object' } },
];

function callResult(payload: unknown): Response {
  return jsonResponse({ isError: false, ms: 1, content: [], structuredContent: payload });
}

function baseRoutes(overrides: Partial<Record<string, FetchRoute>> = {}): Record<
  string,
  FetchRoute
> {
  return {
    '/api/upwork/status': () => jsonResponse({ state: 'connected' }),
    '/api/upwork/account': () =>
      jsonResponse({
        account: { orgUid: 'org-1', name: 'Org One', role: 'TALENT', roleLabel: 'Freelancer', suspended: false },
        accounts: [],
        source: 'stored',
      }),
    '/api/tools': () => jsonResponse({ tools: LIVE_TOOLS, count: LIVE_TOOLS.length, fetchedAt: '2026-10-11T00:00:00.000Z' }),
    '/api/tools/upwork__list_freelancer_proposals/call': () =>
      callResult({ invitations: [{ title: 'Inv A', client_name: 'Client A' }] }),
    '/api/tools/upwork__list_offers/call': () => callResult({ offers: [] }),
    '/api/tools/upwork__get_messages/call': () =>
      callResult({ rooms: [{ name: 'Room 1' }, { name: 'Room 2' }, { name: 'Room 3' }] }),
    '/api/tools/upwork__find_jobs/call': () =>
      callResult({
        jobs: [
          { id: '1', title: 'Matched job one', fixed_price: 100 },
          { id: '2', title: 'Matched job two', hourly_rate: 50 },
        ],
      }),
    '/api/tools/upwork__get_profile/call': () => callResult({ balance: 12 }),
    ...overrides,
  };
}

function renderPage(routes: Record<string, FetchRoute>) {
  vi.stubGlobal('fetch', fetchMock(routes));
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AccountProvider>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
        </Routes>
      </AccountProvider>
    </MemoryRouter>,
  );
}

describe('DashboardPage (plan 06)', () => {
  it('loads every card independently with live data', async () => {
    renderPage(baseRoutes());

    for (const title of ['Invitations', 'Open offers', 'Active messages', 'Matched jobs', 'Connects']) {
      expect(await screen.findByText(title)).toBeInTheDocument();
    }
    // Card data lands in separate commits — wait for each one.
    expect(await screen.findByText('Inv A — Client A')).toBeInTheDocument();
    expect(await screen.findByText('No open offers.')).toBeInTheDocument();
    expect(await screen.findByText('Matched job one')).toBeInTheDocument();
    expect(await screen.findByText('Matched job two')).toBeInTheDocument();
    expect(await screen.findByText('12 Connects')).toBeInTheDocument();
    expect(await screen.findByText('Hi Org One — here is your Upwork at a glance.')).toBeInTheDocument();
  });

  it('shows a per-card unavailable state when a tool is missing from the live list', async () => {
    const tools = LIVE_TOOLS.filter((t) => t.name !== 'upwork__get_profile');
    renderPage(
      baseRoutes({
        '/api/tools': () => jsonResponse({ tools, count: tools.length, fetchedAt: '2026-10-11T00:00:00.000Z' }),
      }),
    );

    expect(
      await screen.findByText(/not in the live list/),
    ).toBeInTheDocument();
    // The other cards still load.
    expect(await screen.findByText('Inv A — Client A')).toBeInTheDocument();
  });

  it('shows a per-card error with retry when a tool call fails', async () => {
    renderPage(
      baseRoutes({
        '/api/tools/upwork__list_offers/call': () =>
          jsonResponse({
            isError: true,
            ms: 1,
            content: [{ type: 'text', text: 'Upstream failed' }],
          }),
      }),
    );

    expect(await screen.findByText('Upstream failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // Sibling cards are unaffected.
    expect(await screen.findByText('Matched job one')).toBeInTheDocument();
  });

  it('offers the standard connect CTA while disconnected', async () => {
    const routes = baseRoutes();
    routes['/api/upwork/status'] = () => jsonResponse({ state: 'disconnected' });
    renderPage(routes);

    expect(
      await screen.findByText(/You are not connected to Upwork\. Connect to load the Dashboard\./),
    ).toBeInTheDocument();
  });
});
