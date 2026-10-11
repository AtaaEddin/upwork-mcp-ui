import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AccountProvider } from '../context/account.js';
import { fetchMock, jsonResponse, type FetchRoute } from '../test/fetchMock.js';
import { ProposalsPage } from './ProposalsPage.js';

/**
 * Proposals page (plan 07a): list (status filter) + detail, asserted
 * through the HTTP surface with recorded tool calls.
 */

const LIVE = ['upwork__list_freelancer_proposals'];

const ROWS = [
  {
    id: '900',
    job_key: '~02jobalpha',
    title: 'Senior React developer',
    client_name: 'Acme',
    status: 'Pending',
    status_label: 'Submitted',
    terms: { charged_amount: 3000 },
    posted_at: '2026-10-11T10:00:00Z',
  },
  {
    id: '901',
    job_key: '~02jobbeta',
    title: 'Python backend',
    client_name: 'Beta Co',
    status: 'Hired',
  },
];

interface Scenario {
  rows?: unknown[];
  detail?: unknown;
}

function toolRoute(
  scenario: Scenario,
  calls: Array<{ tool: string; args: Record<string, unknown> }>,
): FetchRoute {
  return async (req) => {
    const body = (await req.json()) as { args: Record<string, unknown> };
    calls.push({ tool: 'upwork__list_freelancer_proposals', args: body.args });
    const action = body.args.action as string;
    if (action === 'get') {
      return jsonResponse({
        isError: false,
        ms: 1,
        content: [],
        structuredContent:
          scenario.detail ?? {
            proposal: {
              id: '900',
              status: 'Pending',
              status_label: 'Submitted',
              job_title: 'Senior React developer',
              job_key: '~02jobalpha',
              terms: { charged_amount: 3000, connects_bid: 5 },
              cover_letter: 'Hi there…',
              screening_answers: [{ question: 'Q1', answer: 'A1' }],
            },
          },
      });
    }
    return jsonResponse({
      isError: false,
      ms: 1,
      content: [],
      structuredContent: { proposals: scenario.rows ?? ROWS },
    });
  };
}

function renderPage(scenario: Scenario = {}) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  vi.stubGlobal(
    'fetch',
    fetchMock({
      '/api/upwork/status': () => jsonResponse({ state: 'connected' }),
      '/api/upwork/account': () =>
        jsonResponse({
          account: {
            orgUid: 'org-1',
            name: 'Org One',
            role: 'TALENT',
            roleLabel: 'Freelancer',
            suspended: false,
          },
          accounts: [],
          source: 'stored',
        }),
      '/api/tools': () =>
        jsonResponse({
          tools: LIVE.map((name) => ({ name, description: '', inputSchema: { type: 'object' } })),
          count: LIVE.length,
          fetchedAt: '2026-10-11T00:00:00.000Z',
        }),
      '/api/tools/upwork__list_freelancer_proposals/call': toolRoute(scenario, calls),
    }),
  );
  render(
    <MemoryRouter initialEntries={['/proposals']}>
      <AccountProvider>
        <Routes>
          <Route path="/proposals" element={<ProposalsPage />} />
        </Routes>
      </AccountProvider>
    </MemoryRouter>,
  );
  return { calls };
}

describe('ProposalsPage (plan 07a)', () => {
  it('lists proposals with the default filter (no status arg) and status_label', async () => {
    const { calls } = renderPage();
    const row = await screen.findByRole('button', { name: /Senior React developer/ });
    expect(row).toBeInTheDocument();
    // status_label preferred over the raw code.
    expect(row).toHaveTextContent('Submitted');
    expect(row).not.toHaveTextContent('Pending');
    expect(screen.getByRole('button', { name: /Python backend/ })).toHaveTextContent('Hired');

    const listCall = calls.find((c) => c.args.action === 'list');
    expect(listCall?.args).toEqual({ action: 'list', org_uid: 'org-1' });
  });

  it('re-calls with an explicit status when the filter changes', async () => {
    const { calls } = renderPage();
    await screen.findByRole('button', { name: /Senior React developer/ });

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Pending' } });
    await waitFor(() => {
      expect(calls.filter((c) => c.args.action === 'list')).toHaveLength(2);
    });
    const listCalls = calls.filter((c) => c.args.action === 'list');
    expect(listCalls[1]?.args).toEqual({ action: 'list', org_uid: 'org-1', status: 'Pending' });
  });

  it('selecting a row loads its details via get(id)', async () => {
    const { calls } = renderPage();
    await screen.findByRole('button', { name: /Senior React developer/ });

    fireEvent.click(screen.getByRole('button', { name: /Senior React developer/ }));
    const detail = await screen.findByText('Hi there…');
    expect(detail).toBeInTheDocument();
    expect(screen.getByText('Q1')).toBeInTheDocument();

    const getCall = calls.find((c) => c.args.action === 'get');
    expect(getCall?.args).toEqual({ action: 'get', org_uid: 'org-1', id: '900' });
  });

  it('shows the empty state for an empty result', async () => {
    renderPage({ rows: [] });
    expect(await screen.findByText(/no proposals for this status yet/i)).toBeInTheDocument();
  });

  it('degrades to a per-card unavailable state when the tool is missing', async () => {
    vi.stubGlobal(
      'fetch',
      fetchMock({
        '/api/upwork/status': () => jsonResponse({ state: 'connected' }),
        '/api/upwork/account': () =>
          jsonResponse({
            account: {
              orgUid: 'org-1',
              name: 'Org One',
              role: 'TALENT',
              roleLabel: 'Freelancer',
              suspended: false,
            },
            accounts: [],
            source: 'stored',
          }),
        '/api/tools': () =>
          jsonResponse({ tools: [], count: 0, fetchedAt: '2026-10-11T00:00:00.000Z' }),
      }),
    );
    render(
      <MemoryRouter initialEntries={['/proposals']}>
        <AccountProvider>
          <Routes>
            <Route path="/proposals" element={<ProposalsPage />} />
          </Routes>
        </AccountProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/is not in the live list/i)).toBeInTheDocument();
  });
});
