import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AccountProvider } from '../context/account.js';
import { fetchMock, jsonResponse, type FetchRoute } from '../test/fetchMock.js';
import { InvitationsPage } from './InvitationsPage.js';

/**
 * Invitations & offers page (plan 07b): tabs, row → inline detail +
 * actions, finalize link on binding accept, list refresh after success.
 */

const LIVE = [
  'upwork__list_freelancer_proposals',
  'upwork__list_offers',
  'upwork__manage_proposals',
  'upwork__respond_to_offer',
  'upwork__confirm_preview',
];

const INVITATIONS = [
  {
    invitation_id: 'inv-1',
    job_key: '~02jobdelta',
    job_id: '141',
    title: 'React dashboard',
    client_name: 'Delta Co',
    rate: '$60/hr',
    expires_at: '2026-10-20',
    status: 'Open',
  },
];

const OFFERS = [
  { id: 'off-1', job_key: '~02jobbravo', job_title: 'Backend fix', client_name: 'Bravo', hourly_rate: 55 },
  { id: 'off-2', job_title: 'Site audit', client_name: 'Cara', fixed_price: 4200 },
];

interface Scenario {
  invitations?: unknown[];
  offers?: unknown[];
  accept?: unknown;
  decline?: unknown;
  requestChanges?: unknown;
  confirm?: unknown;
}

function toolRoute(
  scenario: Scenario,
  calls: Array<{ tool: string; args: Record<string, unknown> }>,
): FetchRoute {
  return async (req) => {
    const url = new URL(req.url, 'http://localhost');
    const tool = url.pathname.split('/').filter(Boolean).find((p) => p.startsWith('upwork__')) ?? '';
    const body = (await req.json()) as { args: Record<string, unknown> };
    calls.push({ tool, args: body.args });
    const action = body.args.action as string;

    if (tool === 'upwork__list_freelancer_proposals' && action === 'invitations') {
      return jsonResponse({
        isError: false,
        ms: 1,
        content: [],
        structuredContent: { invitations: scenario.invitations ?? INVITATIONS },
      });
    }
    if (tool === 'upwork__list_offers') {
      return jsonResponse({
        isError: false,
        ms: 1,
        content: [],
        structuredContent: { offers: scenario.offers ?? OFFERS },
      });
    }
    if (tool === 'upwork__manage_proposals') {
      return jsonResponse({
        isError: false,
        ms: 1,
        content: [],
        structuredContent:
          action === 'decline_invitation'
            ? (scenario.decline ?? { status: 'ok' })
            : (scenario.accept ?? { status: 'action_required', finalize_url: 'https://www.upwork.com/ab/2/fin' }),
      });
    }
    if (tool === 'upwork__respond_to_offer') {
      const content =
        action === 'decline'
          ? (scenario.decline ?? { status: 'ok' })
          : action === 'request_changes'
            ? (scenario.requestChanges ?? { status: 'ok' })
            : (scenario.accept ?? { status: 'action_required', finalize_url: 'https://www.upwork.com/ab/2/off' });
      return jsonResponse({ isError: false, ms: 1, content: [], structuredContent: content });
    }
    if (tool === 'upwork__confirm_preview') {
      return jsonResponse({
        isError: false,
        ms: 1,
        content: [],
        structuredContent: scenario.confirm ?? { status: 'confirmed' },
      });
    }
    return jsonResponse({ isError: false, ms: 1, content: [], structuredContent: null });
  };
}

function renderPage(scenario: Scenario = {}, path = '/invitations') {
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
      '/api/tools/upwork__list_offers/call': toolRoute(scenario, calls),
      '/api/tools/upwork__manage_proposals/call': toolRoute(scenario, calls),
      '/api/tools/upwork__respond_to_offer/call': toolRoute(scenario, calls),
      '/api/tools/upwork__confirm_preview/call': toolRoute(scenario, calls),
    }),
  );
  render(
    <MemoryRouter initialEntries={[path]}>
      <AccountProvider>
        <Routes>
          <Route path="/invitations" element={<InvitationsPage />} />
        </Routes>
      </AccountProvider>
    </MemoryRouter>,
  );
  return { calls };
}

const callsFor = (
  calls: Array<{ tool: string; args: Record<string, unknown> }>,
  tool: string,
) => calls.filter((c) => c.tool === tool);

describe('InvitationsPage (plan 07b)', () => {
  it('defaults to the invitations tab and calls only the invitations action', async () => {
    const { calls } = renderPage();
    expect(await screen.findByRole('button', { name: /React dashboard/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Invitations' })).toHaveAttribute('aria-selected', 'true');

    await waitFor(() =>
      expect(
        callsFor(calls, 'upwork__list_freelancer_proposals').some(
          (c) => c.args.action === 'invitations',
        ),
      ).toBe(true),
    );
    expect(callsFor(calls, 'upwork__list_offers')).toHaveLength(0);
  });

  it('switching to offers calls list_mine and shows offer rows', async () => {
    const { calls } = renderPage();
    await screen.findByRole('button', { name: /React dashboard/ });
    fireEvent.click(screen.getByRole('tab', { name: 'Offers' }));

    expect(await screen.findByRole('button', { name: /Backend fix/ })).toHaveTextContent('$55/hr');
    expect(screen.getByRole('button', { name: /Site audit/ })).toHaveTextContent('$4,200');
    expect(callsFor(calls, 'upwork__list_offers')[0]?.args).toEqual({
      action: 'list_mine',
      org_uid: 'org-1',
    });
  });

  it('selecting a row shows the inline detail + actions without extra calls', async () => {
    const { calls } = renderPage();
    const row = await screen.findByRole('button', { name: /React dashboard/ });
    const before = calls.length;
    fireEvent.click(row);

    expect(await screen.findByText('Invitation details')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept invitation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^decline$/i })).toBeInTheDocument();
    // The detail is the row itself — no extra tool calls.
    expect(calls.length).toBe(before);
  });

  it('binding accept: confirm → finalize link, no list refresh yet', async () => {
    const { calls } = renderPage();
    await screen.findByRole('button', { name: /React dashboard/ });
    fireEvent.click(screen.getByRole('button', { name: /React dashboard/ }));
    await screen.findByRole('button', { name: /accept invitation/i });

    fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/accepting is a binding action/i)).toBeInTheDocument();
    expect(callsFor(calls, 'upwork__manage_proposals')).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept' }));
    const link = await screen.findByRole('link', { name: /finish on upwork\.com/i });
    expect(link).toHaveAttribute('href', 'https://www.upwork.com/ab/2/fin');
    const acceptCall = callsFor(calls, 'upwork__manage_proposals')[0];
    expect(acceptCall?.args).toEqual({
      action: 'accept_invitation',
      job_id: '141',
      org_uid: 'org-1',
    });
    // Binding: the list is NOT refreshed — the step still has to finish on
    // upwork.com before the invitation can disappear.
    expect(
      callsFor(calls, 'upwork__list_freelancer_proposals').filter((c) => c.args.action === 'invitations'),
    ).toHaveLength(1);
  });

  it('a direct decline success refreshes the invitations list', async () => {
    const { calls } = renderPage({ decline: { status: 'ok' } });
    await screen.findByRole('button', { name: /React dashboard/ });
    fireEvent.click(screen.getByRole('button', { name: /React dashboard/ }));
    await screen.findByRole('button', { name: /^decline$/i });

    const before = callsFor(calls, 'upwork__list_freelancer_proposals').length;
    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));
    await screen.findByRole('dialog');
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Decline' }),
    );
    await waitFor(() => {
      expect(
        callsFor(calls, 'upwork__list_freelancer_proposals').length,
      ).toBeGreaterThan(before);
    });
  });

  it('shows the empty state per tab', async () => {
    const { calls } = renderPage({ invitations: [], offers: [] });
    expect(await screen.findByText(/no open invitations right now/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Offers' }));
    expect(await screen.findByText(/no open offers right now/i)).toBeInTheDocument();
    expect(calls.length).toBeGreaterThan(0);
  });

  it('degrades per card when a tool is missing from the live list', async () => {
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
      <MemoryRouter initialEntries={['/invitations']}>
        <AccountProvider>
          <Routes>
            <Route path="/invitations" element={<InvitationsPage />} />
          </Routes>
        </AccountProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/is not in the live list/i)).toBeInTheDocument();
  });
});
