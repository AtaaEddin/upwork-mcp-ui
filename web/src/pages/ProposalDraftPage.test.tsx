import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AccountProvider } from '../context/account.js';
import { fetchMock, jsonResponse, type FetchRoute } from '../test/fetchMock.js';
import { ProposalDraftPage } from './ProposalDraftPage.js';

/**
 * Proposal draft flow (plan 07a): preflight, form, create-preview,
 * review, confirm-submit, verification. All assertions go through the
 * HTTP surface; tool calls are recorded to assert exact args.
 */

const LIVE = [
  'upwork__find_jobs',
  'upwork__list_freelancer_proposals',
  'upwork__manage_proposals',
  'upwork__confirm_preview',
  'upwork__get_profile',
];

const JOB_PAYLOAD = {
  job: {
    id: '111',
    job_key: '~02jobalpha',
    title: 'Senior React developer',
    url: 'https://www.upwork.com/jobs/~02jobalpha',
    client_name: 'Acme Inc',
    budget: { fixed_price: { min: 2000, max: 5000 } },
    connects_cost: 10,
    applied: false,
    screening_questions: ['Why are you a good fit?'],
    client_feedback: 'Top client',
  },
};

interface Scenario {
  applied?: boolean;
  invitation?: boolean;
  /** Structured content of the preflight proposals list (default: empty). */
  existing?: unknown;
  /** Structured content of `manage_proposals` create (or a tool error). */
  create?: unknown;
  createError?: string;
  /** Structured content of `confirm_preview` confirm. */
  confirm?: unknown;
  confirmError?: string;
  balance?: number;
}

function toolRoute(
  tool: string,
  scenario: Scenario,
  calls: Array<{ tool: string; args: Record<string, unknown> }>,
): FetchRoute {
  return async (req) => {
    const body = (await req.json()) as { args: Record<string, unknown> };
    calls.push({ tool, args: body.args });
    const action = body.args.action as string;

    if (tool === 'upwork__find_jobs') {
      return jsonResponse({
        isError: false,
        ms: 1,
        content: [],
        structuredContent: {
          job: { ...JOB_PAYLOAD.job, applied: scenario.applied === true },
        },
      });
    }
    if (tool === 'upwork__get_profile') {
      if (action === 'connects_balance') {
        return jsonResponse({
          isError: false,
          ms: 1,
          content: [],
          structuredContent: { balance: scenario.balance ?? 12 },
        });
      }
      return jsonResponse({
        isError: false,
        ms: 1,
        content: [],
        structuredContent: {
          portfolio_projects: [{ id: 'pp-1', title: 'Dashboard' }],
          certificates: [{ id: 'cert-1', title: 'AWS' }],
        },
      });
    }
    if (tool === 'upwork__list_freelancer_proposals') {
      if (action === 'invitations') {
        return jsonResponse({
          isError: false,
          ms: 1,
          content: [],
          structuredContent: {
            invitations: scenario.invitation
              ? [{ invitation_id: 'inv-1', job: { id: '111', job_key: '~02jobalpha' } }]
              : [],
          },
        });
      }
      if (action === 'get') {
        return jsonResponse({
          isError: false,
          ms: 1,
          content: [],
          structuredContent: {
            proposal: {
              id: '900',
              status: 'Pending',
              status_label: 'Submitted',
              terms: { charged_amount: 3000, connects_bid: 5 },
              job_title: 'Senior React developer',
              job_key: '~02jobalpha',
            },
          },
        });
      }
      // action 'list' — preflight (no status) or post-confirm verification.
      if (body.args.status === 'Pending') {
        return jsonResponse({
          isError: false,
          ms: 1,
          content: [],
          structuredContent: {
            proposals: [
              {
                id: '900',
                job_key: '~02jobalpha',
                title: 'Senior React developer',
                status: 'Pending',
                status_label: 'Submitted',
                terms: { charged_amount: 3000, connects_bid: 5 },
              },
            ],
          },
        });
      }
      return jsonResponse({
        isError: false,
        ms: 1,
        content: [],
        structuredContent: scenario.existing ?? { proposals: [] },
      });
    }
    if (tool === 'upwork__manage_proposals') {
      if (scenario.createError !== undefined) {
        return jsonResponse({
          isError: true,
          ms: 1,
          content: [{ type: 'text', text: scenario.createError }],
          structuredContent: null,
        });
      }
      return jsonResponse({
        isError: false,
        ms: 1,
        content: [],
        structuredContent: scenario.create ?? {
          preview_id: 'pv-1',
          type: 'proposal',
          connects_required: 10,
          connects_balance: 12,
          boost: {
            available: true,
            max_connects: 20,
            suggested_bid: 5,
            recommendation: 'consider',
          },
        },
      });
    }
    if (tool === 'upwork__confirm_preview') {
      if (scenario.confirmError !== undefined) {
        return jsonResponse({
          isError: true,
          ms: 1,
          content: [{ type: 'text', text: scenario.confirmError }],
          structuredContent: null,
        });
      }
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
          tools: LIVE.map((name) => ({
            name,
            description: '',
            inputSchema: { type: 'object' },
          })),
          count: LIVE.length,
          fetchedAt: '2026-10-11T00:00:00.000Z',
        }),
      '/api/tools/upwork__find_jobs/call': toolRoute('upwork__find_jobs', scenario, calls),
      '/api/tools/upwork__list_freelancer_proposals/call': toolRoute(
        'upwork__list_freelancer_proposals',
        scenario,
        calls,
      ),
      '/api/tools/upwork__get_profile/call': toolRoute('upwork__get_profile', scenario, calls),
      '/api/tools/upwork__manage_proposals/call': toolRoute(
        'upwork__manage_proposals',
        scenario,
        calls,
      ),
      '/api/tools/upwork__confirm_preview/call': toolRoute(
        'upwork__confirm_preview',
        scenario,
        calls,
      ),
    }),
  );
  render(
    <MemoryRouter initialEntries={['/jobs/~02jobalpha/propose']}>
      <AccountProvider>
        <Routes>
          <Route path="/jobs/:jobKey/propose" element={<ProposalDraftPage />} />
        </Routes>
      </AccountProvider>
    </MemoryRouter>,
  );
  return { calls };
}

function callsFor(calls: Array<{ tool: string; args: Record<string, unknown> }>, tool: string) {
  return calls.filter((c) => c.tool === tool);
}

function fillDraft() {
  fireEvent.change(screen.getByLabelText('Cover letter'), {
    target: { value: 'I am the person for this job.' },
  });
  fireEvent.change(screen.getByLabelText(/your bid/i), { target: { value: '3000' } });
  fireEvent.change(screen.getByLabelText('Why are you a good fit?'), {
    target: { value: 'Because I ship fast.' },
  });
}

const createModalButton = (): HTMLElement =>
  within(screen.getByRole('dialog')).getByRole('button', { name: 'Create preview' });
const submitModalButton = (): HTMLElement =>
  within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit proposal' });

describe('ProposalDraftPage (plan 07a)', () => {
  it('runs the documented preflight, then shows the form with cost and bid', async () => {
    const { calls } = renderPage();
    await screen.findByText('Senior React developer');
    await screen.findByText(/Applying costs 10 Connects · balance 12/);

    expect(screen.getByText('Top client')).toBeInTheDocument();
    expect(screen.getByText('Why are you a good fit?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue — create preview/i })).toBeDisabled();

    await waitFor(() => {
      expect(callsFor(calls, 'upwork__find_jobs')).toHaveLength(1);
      expect(callsFor(calls, 'upwork__list_freelancer_proposals')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            args: expect.objectContaining({ action: 'invitations', org_uid: 'org-1' }),
          }),
          expect.objectContaining({
            args: expect.objectContaining({ action: 'list', org_uid: 'org-1' }),
          }),
        ]),
      );
      expect(callsFor(calls, 'upwork__get_profile').map((c) => c.args.action)).toEqual(
        expect.arrayContaining(['connects_balance', 'list_highlights']),
      );
    });
    const jobCall = callsFor(calls, 'upwork__find_jobs')[0];
    expect(jobCall?.args).toMatchObject({ action: 'get', org_uid: 'org-1', id: '~02jobalpha' });

    // No write action may have been made yet.
    expect(callsFor(calls, 'upwork__manage_proposals')).toHaveLength(0);
    expect(callsFor(calls, 'upwork__confirm_preview')).toHaveLength(0);
  });

  it('full happy path: form → create preview → review → confirm → submitted + verify', async () => {
    const { calls } = renderPage();
    await screen.findByText(/Applying costs 10 Connects · balance 12/);
    fillDraft();

    // Step 1 asks for confirmation BEFORE the create call.
    fireEvent.click(screen.getByRole('button', { name: /continue — create preview/i }));
    await screen.findByText(/nothing is submitted and no connects are charged yet/i);
    expect(callsFor(calls, 'upwork__manage_proposals')).toHaveLength(0);

    fireEvent.click(createModalButton());
    const createCall = await waitFor((): Record<string, unknown> | undefined => {
      const list = callsFor(calls, 'upwork__manage_proposals');
      expect(list.length).toBeGreaterThan(0);
      return list[0]?.args;
    });
    expect(createCall).toMatchObject({
      action: 'create',
      org_uid: 'org-1',
      job_id: '111',
      charged_amount: 3000,
      cover_letter: 'I am the person for this job.',
    });
    expect(createCall?.screening_answers).toEqual([
      { question: 'Why are you a good fit?', answer: 'Because I ship fast.' },
    ]);

    // Review panel: cost + boost + the submit control exist only post-preview.
    expect(await screen.findByText('Review before you submit')).toBeInTheDocument();
    expect(screen.getByText('10 Connects')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit proposal/i })).toBeEnabled();
    expect(callsFor(calls, 'upwork__confirm_preview')).toHaveLength(0);

    // Step 2 asks for confirmation BEFORE the confirm call.
    fireEvent.click(screen.getByRole('button', { name: /submit proposal/i }));
    await screen.findByText(/once submitted, the bid cannot be edited or withdrawn/i);
    expect(callsFor(calls, 'upwork__confirm_preview')).toHaveLength(0);

    // Boost 5 approved in the review panel.
    fireEvent.change(screen.getByLabelText(/additional connects/i), {
      target: { value: '5' },
    });
    fireEvent.click(submitModalButton());
    const confirmArgs = await waitFor((): Record<string, unknown> | undefined => {
      const list = callsFor(calls, 'upwork__confirm_preview');
      expect(list.length).toBeGreaterThan(0);
      return list[0]?.args;
    });
    expect(confirmArgs).toEqual({
      action: 'confirm',
      org_uid: 'org-1',
      type: 'proposal',
      preview_id: 'pv-1',
      boost_connects: 5,
    });

    // Submitted + verified via list(status Pending) + get(id).
    expect(await screen.findByText('Proposal submitted')).toBeInTheDocument();
    expect(screen.getByText(/Stored bid: 5 Connects/)).toBeInTheDocument();
    const verifyList = callsFor(calls, 'upwork__list_freelancer_proposals').find(
      (c) => c.args.action === 'list' && c.args.status === 'Pending',
    );
    expect(verifyList?.args).toMatchObject({ action: 'list', status: 'Pending', org_uid: 'org-1' });
    const verifyGet = callsFor(calls, 'upwork__list_freelancer_proposals').find(
      (c) => c.args.action === 'get' && c.args.id === '900',
    );
    expect(verifyGet?.args.org_uid).toBe('org-1');
  });

  it('never renders a submit control before a confirmable preview (create error)', async () => {
    const { calls } = renderPage({ create: { weird: true } });
    await screen.findByText(/Applying costs 10 Connects · balance 12/);
    expect(screen.queryByRole('button', { name: /submit proposal/i })).toBeNull();

    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: /continue — create preview/i }));
    await screen.findByText(/nothing is submitted and no connects are charged yet/i);
    fireEvent.click(createModalButton());
    // create returned no preview_id/type ⇒ the modal surfaces the failure,
    // the form is back, and no confirm call can exist.
    expect(await screen.findByText(/did not return a confirmable preview/i)).toBeInTheDocument();
    expect(callsFor(calls, 'upwork__confirm_preview')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /submit proposal/i })).toBeNull();
  });

  it('surfaces the server needs_details text when create fails with it', async () => {
    const { calls } = renderPage({ createError: 'Missing fields: cover_letter' });
    await screen.findByText(/Applying costs 10 Connects · balance 12/);
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: /continue — create preview/i }));
    await screen.findByText(/nothing is submitted and no connects are charged yet/i);
    fireEvent.click(createModalButton());
    expect(await screen.findByText('Missing fields: cover_letter')).toBeInTheDocument();
    expect(callsFor(calls, 'upwork__confirm_preview')).toHaveLength(0);
  });

  it('surfaces a tool-level error from the confirm step verbatim', async () => {
    const { calls } = renderPage({
      confirmError: 'unauthorized: access token expired',
    });
    await screen.findByText(/Applying costs 10 Connects · balance 12/);
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: /continue — create preview/i }));
    await screen.findByText(/nothing is submitted and no connects are charged yet/i);
    fireEvent.click(createModalButton());
    await screen.findByText('Review before you submit');
    fireEvent.click(screen.getByRole('button', { name: /submit proposal/i }));
    await screen.findByText(/once submitted, the bid cannot be edited or withdrawn/i);
    fireEvent.click(submitModalButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('access token expired');
    expect(callsFor(calls, 'upwork__confirm_preview')).toHaveLength(1);
  });

  it('already-applied jobs show the notice instead of the form', async () => {
    renderPage({ applied: true });
    expect(await screen.findByText(/you already applied to this job/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Cover letter')).toBeNull();
  });

  it('invited jobs show the invitation notice instead of the form', async () => {
    renderPage({ invitation: true });
    expect(
      await screen.findByText(/this job reached you as an invitation/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Cover letter')).toBeNull();
    expect(screen.getByRole('link', { name: /view invitations/i })).toHaveAttribute(
      'href',
      '/invitations',
    );
  });
});
