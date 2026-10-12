import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { fetchMock, jsonResponse, type FetchRoute } from '../test/fetchMock.js';
import { AccountProvider } from '../context/account.js';
import { JobDetailPage } from './JobDetailPage.js';

const LIVE_TOOLS = [{ name: 'upwork__find_jobs', description: '', inputSchema: { type: 'object' } }];

const DETAIL = {
  job: {
    id: '12345',
    job_key: '~02abc',
    title: 'Build a React dashboard',
    url: 'https://www.upwork.com/jobs/~02abc',
    fixed_price: { min: 500, max: 1000 },
    connects_cost: 3,
    posted_at: '2026-10-01T00:00:00Z',
    client: { name: 'Acme', rating: 4.9 },
    description: 'We need a React expert.',
    screening_questions: ['Why you?'],
    skills: ['React', 'Vite'],
    applied: false,
  },
};

const JOB_ERROR_TEXT = 'id is required (trace_id: 9db0f5ec6f565232368425a55c74b05b)';

function renderDetail(
  applied = false,
  extra: Partial<Record<string, FetchRoute>> = {},
  opts: { entry?: string; jobErrorFor?: string } = {},
) {
  const calls: Array<Record<string, unknown>> = [];
  const entry = opts.entry ?? '/jobs/~02abc';
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
        jsonResponse({ tools: LIVE_TOOLS, count: LIVE_TOOLS.length, fetchedAt: '2026-10-11T00:00:00.000Z' }),
      '/api/tools/upwork__find_jobs/call': async (req) => {
        const parsed = JSON.parse(await req.text()) as { args: Record<string, unknown> };
        calls.push(parsed.args);
        if (opts.jobErrorFor !== undefined && parsed.args.id === opts.jobErrorFor) {
          return jsonResponse({
            isError: true,
            ms: 1,
            content: [{ type: 'text', text: JOB_ERROR_TEXT }],
          });
        }
        return jsonResponse({
          isError: false,
          ms: 1,
          content: [],
          structuredContent: applied ? { ...DETAIL, job: { ...DETAIL.job, applied: true } } : DETAIL,
        });
      },
      ...extra,
    }),
  );
  return {
    calls,
    view: render(
      <MemoryRouter initialEntries={[entry]}>
        <AccountProvider>
          <Routes>
            <Route path="/jobs/:jobKey" element={<JobDetailPage />} />
          </Routes>
        </AccountProvider>
      </MemoryRouter>,
    ),
  };
}

describe('JobDetailPage (plan 06)', () => {
  it('fetches the job with action=get and the route key as id', async () => {
    const { calls } = renderDetail();

    expect(await screen.findByText('Build a React dashboard')).toBeInTheDocument();
    expect(calls[0]).toEqual({ action: 'get', org_uid: 'org-1', id: '~02abc' });

    expect(screen.getByText('3 Connects')).toBeInTheDocument();
    expect(screen.getByText('We need a React expert.')).toBeInTheDocument();
    expect(screen.getByText('Why you?')).toBeInTheDocument();
    expect(screen.getByText('Fixed: $500 – $1000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open on upwork\.com/i })).toHaveAttribute(
      'href',
      'https://www.upwork.com/jobs/~02abc',
    );
  });

  it('links to the proposal draft flow when not applied', async () => {
    renderDetail();

    const link = await screen.findByRole('link', { name: 'Write proposal' });
    expect(link).toHaveAttribute('href', '/jobs/~02abc/propose');
  });

  it('notes when the job is already applied (no CTA)', async () => {
    renderDetail(true);

    expect(await screen.findByText(/You have already applied/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Write proposal' })).toBeNull();
  });

  it('placeholder key (row-N): no get call, paste-a-reference recovery loads the job (plan 10)', async () => {
    const { calls } = renderDetail(false, {}, { entry: '/jobs/row-3' });

    expect(await screen.findByText('Open this job')).toBeInTheDocument();
    expect(await screen.findByText(/Paste the job URL/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Job URL, numeric job id, or ciphertext'), {
      target: { value: 'https://www.upwork.com/jobs/~02abc' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load job' }));

    expect(await screen.findByText('Build a React dashboard')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      action: 'get',
      org_uid: 'org-1',
      id: 'https://www.upwork.com/jobs/~02abc',
    });
  });

  it('tool error surfaces verbatim; paste recovery re-calls get with the pasted id (plan 10)', async () => {
    const { calls } = renderDetail(false, {}, { jobErrorFor: '~02abc' });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(JOB_ERROR_TEXT);
    expect(await screen.findByText('Try another job reference')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Job URL, numeric job id, or ciphertext'), {
      target: { value: '12345' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load job' }));

    expect(await screen.findByText('Build a React dashboard')).toBeInTheDocument();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ action: 'get', org_uid: 'org-1', id: '12345' });
  });
});
