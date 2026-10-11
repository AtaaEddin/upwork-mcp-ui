import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fetchMock, jsonResponse } from '../test/fetchMock.js';
import { ReAuthBanner } from './ReAuthBanner.js';
import type { UpworkStatus } from '../lib/upwork.js';

const HIDDEN: UpworkStatus[] = [
  { state: 'connected' },
  { state: 'connecting' },
  { state: 'unknown' },
];

describe('ReAuthBanner', () => {
  it.each(HIDDEN)('is hidden for %j', (status) => {
    const { container } = render(<ReAuthBanner status={status} checkCount={1} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows on needs_reauth with reconnect button and dismiss', () => {
    const fetchImpl = fetchMock({
      '/api/upwork/connect': (req) =>
        req.method === 'POST'
          ? jsonResponse({ authorizeUrl: 'http://fake.upwork.local/authorize?state=x' })
          : jsonResponse({ error: { code: 'method_not_allowed', message: 'no' } }, 405),
    });
    vi.stubGlobal('fetch', fetchImpl);

    render(<ReAuthBanner status={{ state: 'needs_reauth' }} checkCount={1} />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(/connection expired/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reconnect to upwork/i })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: /dismiss/i })).toHaveAttribute('type', 'button');
  });

  it('reconnect posts to /api/upwork/connect', async () => {
    const fetchImpl = fetchMock({
      '/api/upwork/connect': (req) =>
        req.method === 'POST'
          ? jsonResponse({ state: 'connected' }) // no authorizeUrl → no navigation
          : jsonResponse({ error: { code: 'method_not_allowed', message: 'no' } }, 405),
    });
    vi.stubGlobal('fetch', fetchImpl);

    render(<ReAuthBanner status={{ state: 'needs_reauth' }} checkCount={1} />);
    fireEvent.click(screen.getByRole('button', { name: /reconnect to upwork/i }));

    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.some((c) => String(c[0]) === '/api/upwork/connect'),
      ).toBe(true),
    );
  });

  it('shows on disconnected with the connect message', () => {
    render(<ReAuthBanner status={{ state: 'disconnected' }} checkCount={1} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/not connected to upwork/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reconnect to upwork/i })).toBeInTheDocument();
  });

  it('dismiss hides the banner', () => {
    render(<ReAuthBanner status={{ state: 'needs_reauth' }} checkCount={1} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reappears after the next check even when dismissed', () => {
    const { rerender } = render(<ReAuthBanner status={{ state: 'needs_reauth' }} checkCount={1} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(<ReAuthBanner status={{ state: 'needs_reauth' }} checkCount={2} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('stays hidden after the next check once connected', () => {
    const { rerender } = render(<ReAuthBanner status={{ state: 'needs_reauth' }} checkCount={1} />);
    rerender(<ReAuthBanner status={{ state: 'connected' }} checkCount={2} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
