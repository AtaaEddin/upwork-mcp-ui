import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { fetchMock, jsonResponse, type FetchRoute } from '../test/fetchMock.js';
import { AccountProvider, useAccount } from './account.js';

function Probe() {
  const { account, loading, error, select, refresh } = useAccount();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="account">{account === null ? '(none)' : account.name}</span>
      <span data-testid="error">{error ?? '(none)'}</span>
      <button type="button" onClick={() => void select('org-2')}>
        select-org-2
      </button>
      <button type="button" onClick={() => void refresh(true)}>
        refresh
      </button>
    </div>
  );
}

const ACCOUNTS = [
  { orgUid: 'org-1', name: 'Org One', role: 'TALENT', roleLabel: 'Freelancer', suspended: false },
  { orgUid: 'org-2', name: 'Org Two', role: 'CLIENT', roleLabel: 'Client', suspended: false },
];

function baseRoutes(status: 'connected' | 'disconnected' = 'connected') {
  return {
    '/api/upwork/status': () => jsonResponse({ state: status }) as Response,
  };
}

function renderProbe(routes: Record<string, FetchRoute>) {
  vi.stubGlobal('fetch', fetchMock(routes));
  return render(
    <MemoryRouter>
      <AccountProvider>
        <Probe />
      </AccountProvider>
    </MemoryRouter>,
  );
}

describe('AccountProvider (plan 06)', () => {
  it('bootstraps the stored selection once connected', async () => {
    const routes: Record<string, FetchRoute> = {
      ...baseRoutes(),
      '/api/upwork/account': () =>
        jsonResponse({ account: ACCOUNTS[0], accounts: ACCOUNTS, source: 'bootstrapped' }),
    };
    renderProbe(routes);

    await vi.waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('Org One'));
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('stays empty while disconnected and never fetches the account', async () => {
    let accountCalls = 0;
    const routes: Record<string, FetchRoute> = {
      ...baseRoutes('disconnected'),
      '/api/upwork/account': () => {
        accountCalls += 1;
        return jsonResponse({ account: null, accounts: [], source: 'none' });
      },
    };
    renderProbe(routes);

    await vi.waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('account')).toHaveTextContent('(none)');
    expect(accountCalls).toBe(0);
  });

  it('select() PUTs the orgUid and updates the selection', async () => {
    let putBody: unknown = null;
    const routes: Record<string, FetchRoute> = {
      ...baseRoutes(),
      '/api/upwork/account': async (req) => {
        if (req.method === 'PUT') {
          putBody = JSON.parse(await req.text()) as unknown;
          return jsonResponse({ account: ACCOUNTS[1] });
        }
        return jsonResponse({ account: ACCOUNTS[0], accounts: ACCOUNTS, source: 'bootstrapped' });
      },
    };
    renderProbe(routes);

    await vi.waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('Org One'));

    screen.getByRole('button', { name: 'select-org-2' }).click();
    await screen.findByText('Org Two');
    expect(putBody).toEqual({ orgUid: 'org-2' });
  });

  it('surfaces an account fetch error with the account reset to null', async () => {
    const routes: Record<string, FetchRoute> = {
      ...baseRoutes(),
      '/api/upwork/account': () =>
        jsonResponse({ error: { code: 'upstream_error', message: 'Upstream failed' } }, 502),
    };
    renderProbe(routes);

    await vi.waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Upstream failed'));
    expect(screen.getByTestId('account')).toHaveTextContent('(none)');
  });
});
