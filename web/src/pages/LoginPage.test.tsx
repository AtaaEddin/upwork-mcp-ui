import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../context/auth.js';
import { fetchMock, jsonResponse, type FetchRoute } from '../test/fetchMock.js';
import { LoginPage } from './LoginPage.js';

/** /api/me that is 401 until the first successful login/setup call. */
function statefulMe(): FetchRoute {
  let calls = 0;
  return () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse({ error: { code: 'unauthorized', message: 'authentication required' } }, 401);
    }
    return jsonResponse({ authenticated: true, owner: true, userId: 1 });
  };
}

function renderLogin(fetchImpl: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchImpl);
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>HOME MARKER</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function defaultFetch(overrides: Record<string, FetchRoute> = {}): ReturnType<typeof vi.fn> {
  return fetchMock({
    '/api/me': statefulMe(),
    '/api/setup': () => jsonResponse({ required: false }),
    ...overrides,
  });
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', defaultFetch());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the login form when an owner exists', async () => {
    renderLogin(defaultFetch());
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });

  it('shows the one-time setup flow when required', async () => {
    renderLogin(
      defaultFetch({
        '/api/me': () =>
          jsonResponse({ error: { code: 'unauthorized', message: 'authentication required' } }, 401),
        '/api/setup': () => jsonResponse({ required: true }),
      }),
    );
    expect(
      await screen.findByRole('heading', { name: /create your owner password/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create password' })).toBeInTheDocument();
  });

  it('rejects a short password client-side (no POST)', async () => {
    const fetchImpl = defaultFetch({
      '/api/me': () =>
        jsonResponse({ error: { code: 'unauthorized', message: 'authentication required' } }, 401),
      '/api/setup': () => jsonResponse({ required: true }),
    });
    renderLogin(fetchImpl);
    await screen.findByRole('heading', { name: /create your owner password/i });

    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 8 characters/i);
    expect(fetchImpl).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects mismatched passwords client-side', async () => {
    renderLogin(
      defaultFetch({
        '/api/me': () =>
          jsonResponse({ error: { code: 'unauthorized', message: 'authentication required' } }, 401),
        '/api/setup': () => jsonResponse({ required: true }),
      }),
    );
    await screen.findByRole('heading', { name: /create your owner password/i });

    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'password-one' },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: 'password-two' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
  });

  it('creates the owner on valid setup, then lands on the dashboard route', async () => {
    let setupPosts = 0;
    renderLogin(
      defaultFetch({
        '/api/setup': (req) => {
          if (req.method === 'POST') {
            setupPosts += 1;
            return jsonResponse({ ok: true }, 201);
          }
          return jsonResponse({ required: true });
        },
      }),
    );
    await screen.findByRole('heading', { name: /create your owner password/i });

    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'password-one' },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: 'password-one' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create password' }));

    expect(await screen.findByText('HOME MARKER')).toBeInTheDocument();
    expect(setupPosts).toBe(1);
  });

  it('submits the password on login, then lands on the dashboard route', async () => {
    let body: unknown = null;
    renderLogin(
      defaultFetch({
        '/api/login': (req) => {
          void req.json().then((b: unknown) => {
            body = b;
          });
          return jsonResponse({ ok: true });
        },
      }),
    );
    await screen.findByRole('heading', { name: 'Log in' });

    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'password-one' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('HOME MARKER')).toBeInTheDocument();
    await waitFor(() => expect(body).toEqual({ password: 'password-one' }));
  });

  it('shows a friendly error for a wrong password (401)', async () => {
    renderLogin(
      defaultFetch({
        '/api/me': () =>
          jsonResponse({ error: { code: 'unauthorized', message: 'authentication required' } }, 401),
        '/api/login': () =>
          jsonResponse({ error: { code: 'unauthorized', message: 'invalid password' } }, 401),
      }),
    );
    await screen.findByRole('heading', { name: 'Log in' });

    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'wrong-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid password/i);
  });

  it('surfaces the rate-limit retry window (429 + retry-after)', async () => {
    renderLogin(
      defaultFetch({
        '/api/me': () =>
          jsonResponse({ error: { code: 'unauthorized', message: 'authentication required' } }, 401),
        '/api/login': () =>
          jsonResponse(
            { error: { code: 'rate_limited', message: 'too many login attempts' } },
            429,
            { 'retry-after': '42' },
          ),
      }),
    );
    await screen.findByRole('heading', { name: 'Log in' });

    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'password-one' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/try again in 42s/i);
  });

  it('falls back to login when setup is no longer available (404)', async () => {
    renderLogin(
      defaultFetch({
        '/api/me': () =>
          jsonResponse({ error: { code: 'unauthorized', message: 'authentication required' } }, 401),
        '/api/setup': (req) => {
          if (req.method === 'POST') {
            return jsonResponse(
              { error: { code: 'not_found', message: 'setup is no longer available' } },
              404,
            );
          }
          return jsonResponse({ required: true });
        },
      }),
    );
    await screen.findByRole('heading', { name: /create your owner password/i });

    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'password-one' },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: 'password-one' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create password' }));

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('redirects away when a session already exists', async () => {
    renderLogin(
      defaultFetch({
        '/api/me': () => jsonResponse({ authenticated: true, owner: true, userId: 1 }),
      }),
    );
    expect(await screen.findByText('HOME MARKER')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Log in' })).not.toBeInTheDocument();
  });
});
