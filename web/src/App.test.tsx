import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.js';
import { fetchMock, jsonResponse, type FetchRoute } from './test/fetchMock.js';

const me401: FetchRoute = () =>
  jsonResponse({ error: { code: 'unauthorized', message: 'authentication required' } }, 401);
const me200: FetchRoute = () => jsonResponse({ authenticated: true, owner: true, userId: 1 });
const status404: FetchRoute = () =>
  jsonResponse({ error: { code: 'not_found', message: 'resource not found' } }, 404);

function renderApp(
  routes: Record<string, FetchRoute>,
  initialEntries: string[] = ['/'],
): { fetchImpl: ReturnType<typeof vi.fn> } {
  const fetchImpl = fetchMock(routes);
  vi.stubGlobal('fetch', fetchImpl);
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <App />
    </MemoryRouter>,
  );
  return { fetchImpl };
}

describe('App (routing + guard + layout)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock({}));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unauthenticated visitors land on the login form', async () => {
    renderApp({ '/api/me': me401, '/api/setup': () => jsonResponse({ required: false }) });
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('authenticated owner sees the layout, nav links, and unknown status pill', async () => {
    renderApp({ '/api/me': me200, '/api/upwork/status': status404 });
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();

    for (const label of [
      'Jobs',
      'Proposals',
      'Invitations',
      'Messages',
      'Contracts',
      'Profile',
      'Tools',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    // Plan 03 endpoint absent → unknown, no false banner.
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Upwork status unknown' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/trademark of Upwork Global LLC/i)).toBeInTheDocument();
  });

  it('shows the re-auth banner when the status says needs_reauth', async () => {
    renderApp({
      '/api/me': me200,
      '/api/upwork/status': () => jsonResponse({ state: 'needs_reauth' }),
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/connection expired/i);
    expect(screen.getByRole('button', { name: /reconnect to upwork/i })).toBeInTheDocument();
  });

  it('deep links render their sections (jobs shows its connect CTA without a connection)', async () => {
    renderApp({ '/api/me': me200, '/api/upwork/status': status404 }, ['/jobs']);
    expect(await screen.findByRole('heading', { name: 'Find jobs' })).toBeInTheDocument();
    expect(screen.getByText(/Checking your Upwork connection/i)).toBeInTheDocument();
  });

  it('unknown routes render the 404 page', async () => {
    renderApp({ '/api/me': me200, '/api/upwork/status': status404 }, ['/nope']);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toBeInTheDocument();
  });

  it('logs out from the account menu back to the login form', async () => {
    const { fetchImpl } = renderApp({
      '/api/me': me200,
      '/api/setup': () => jsonResponse({ required: false }),
      '/api/upwork/status': status404,
    });
    await screen.findByRole('heading', { name: 'Dashboard' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Account menu' })[0]!);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/logout',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('opens the mobile menu with all section links', async () => {
    renderApp({ '/api/me': me200, '/api/upwork/status': status404 });
    await screen.findByRole('heading', { name: 'Dashboard' });

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const mobileNav = screen.getByRole('navigation', { name: 'Mobile' });
    for (const label of ['Dashboard', 'Jobs', 'Tools']) {
      expect(
        withinNav(mobileNav, label),
      ).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeInTheDocument();
  });
});

function withinNav(nav: HTMLElement, label: string): HTMLElement {
  const links = nav.querySelectorAll('a');
  for (const link of links) {
    if (link.textContent === label) return link;
  }
  throw new Error(`link ${label} not found in mobile nav`);
}
