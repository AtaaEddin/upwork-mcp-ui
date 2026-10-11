import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { fetchMock, jsonResponse } from '../test/fetchMock.js';
import { AccountProvider } from '../context/account.js';
import { ProposalDraftPage } from './sections.js';

describe('ProposalDraftPage (plan 06)', () => {
  it('names the job and points to the tools console until plan 07', async () => {
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
            tools: [{ name: 'upwork__find_jobs', description: '', inputSchema: { type: 'object' } }],
            count: 1,
            fetchedAt: '2026-10-11T00:00:00.000Z',
          }),
        '/api/tools/upwork__find_jobs/call': () =>
          jsonResponse({
            isError: false,
            ms: 1,
            content: [],
            structuredContent: { job: { id: '1', job_key: '~02abc', title: 'Build a React dashboard' } },
          }),
      }),
    );
    render(
      <MemoryRouter initialEntries={['/jobs/~02abc/propose']}>
        <AccountProvider>
          <Routes>
            <Route path="/jobs/:jobKey/propose" element={<ProposalDraftPage />} />
          </Routes>
        </AccountProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Build a React dashboard')).toBeInTheDocument();
    expect(screen.getByText(/plan 07/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open tools console/i })).toHaveAttribute(
      'href',
      '/tools',
    );
    expect(screen.getByRole('link', { name: /back to job/i })).toHaveAttribute(
      'href',
      '/jobs/~02abc',
    );
  });
});
