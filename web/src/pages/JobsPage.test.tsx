import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { fetchMock, jsonResponse, type FetchRoute } from '../test/fetchMock.js';
import { AccountProvider } from '../context/account.js';
import { JobsPage } from './JobsPage.js';

const LIVE_TOOLS = [
  { name: 'upwork__find_jobs', description: 'Find jobs', inputSchema: { type: 'object' } },
  { name: 'upwork__list_freelancer_proposals', description: '', inputSchema: { type: 'object' } },
  { name: 'upwork__list_offers', description: '', inputSchema: { type: 'object' } },
  { name: 'upwork__get_messages', description: '', inputSchema: { type: 'object' } },
  { name: 'upwork__get_profile', description: '', inputSchema: { type: 'object' } },
];

const JOBS_PAGE_1 = {
  jobs: [
    { id: '1', title: 'First job', fixed_price: 500 },
    { id: '2', title: 'Second job', hourly_rate: 40 },
  ],
  total: 42,
  page: 1,
  limit: 20,
  next_page: 2,
  filters_ignored: ['category:foo'],
};

const calls: Array<Record<string, unknown>> = [];

function findJobsHandler(): FetchRoute {
  return async (req) => {
    const parsed = JSON.parse(await req.text()) as { args: Record<string, unknown> };
    calls.push(parsed.args);
    return jsonResponse({ isError: false, ms: 1, content: [], structuredContent: JOBS_PAGE_1 });
  };
}

function renderPage(extra: Partial<Record<string, FetchRoute>> = {}) {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    fetchMock({
      '/api/upwork/status': () => jsonResponse({ state: 'connected' }),
      '/api/upwork/account': () =>
        jsonResponse({
          account: { orgUid: 'org-1', name: 'Org One', role: 'TALENT', roleLabel: 'Freelancer', suspended: false },
          accounts: [],
          source: 'stored',
        }),
      '/api/tools': () => jsonResponse({ tools: LIVE_TOOLS, count: LIVE_TOOLS.length, fetchedAt: '2026-10-11T00:00:00.000Z' }),
      '/api/tools/upwork__find_jobs/call': findJobsHandler(),
      ...extra,
    }),
  );
  return render(
    <MemoryRouter initialEntries={['/jobs']}>
      <AccountProvider>
        <Routes>
          <Route path="/jobs" element={<JobsPage />} />
        </Routes>
      </AccountProvider>
    </MemoryRouter>,
  );
}

describe('JobsPage (plan 06)', () => {
  it('starts with a smart_search of matched jobs', async () => {
    renderPage();

    expect(await screen.findByText('First job')).toBeInTheDocument();
    expect(screen.getByText('Second job')).toBeInTheDocument();
    expect(screen.getByText('Matched jobs')).toBeInTheDocument();
    expect(calls[0]).toEqual({
      action: 'smart_search',
      org_uid: 'org-1',
      mode: 'best_match',
    });
    // Pagination pass-through: "Next page" exists because next_page came back.
    expect(screen.getByText(/42 total/)).toBeInTheDocument();
  });

  it('submits the search form with action=search and the typed filters', async () => {
    renderPage();
    await screen.findByText('First job');

    const keyword = screen.getByPlaceholderText(/react, typescript/i);
    fireEvent.change(keyword, { target: { value: 'react' } });
    fireEvent.change(screen.getByPlaceholderText(/engineering/i), {
      target: { value: 'Web' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await vi.waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1]).toEqual({
      action: 'search',
      org_uid: 'org-1',
      query: 'react',
      category: 'Web',
    });
    expect(screen.getByText('Search results')).toBeInTheDocument();
  });

  it('follows pagination by echoing the returned values', async () => {
    renderPage();
    await screen.findByText('First job');

    fireEvent.click(screen.getByRole('button', { name: /next page/i }));

    await vi.waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1]).toEqual({
      action: 'smart_search',
      org_uid: 'org-1',
      mode: 'best_match',
      page: 1,
      limit: 20,
      next_page: 2,
    });
    expect(screen.getByRole('button', { name: /previous/i })).toBeEnabled();
  });

  it('surfaces empty_reason, filters_ignored and needs_details from the server', async () => {
    const empty: Record<string, unknown> = {
      empty_reason: 'No jobs match your filters',
      filters_ignored: ['budget_min:10'],
      needs_details: 'Please specify a category',
      jobs: [],
    };
    renderPage({
      '/api/tools/upwork__find_jobs/call': () =>
        jsonResponse({ isError: false, ms: 1, content: [], structuredContent: empty }),
    });

    expect(await screen.findByText('No jobs match your filters')).toBeInTheDocument();
    expect(screen.getByText(/Upwork ignored some filters: budget_min:10/)).toBeInTheDocument();
    expect(screen.getByText(/More details needed: Please specify a category/)).toBeInTheDocument();
  });

  it('shows the connected-not CTA when the connection is down', async () => {
    renderPage({
      '/api/upwork/status': () => jsonResponse({ state: 'disconnected' }),
    });
    expect(
      await screen.findByText(/You are not connected to Upwork\. Connect to load the Find jobs\./),
    ).toBeInTheDocument();
  });
});
