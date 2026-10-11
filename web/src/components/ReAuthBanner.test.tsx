import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

  it('shows on needs_reauth with the reconnect form and dismiss', () => {
    render(<ReAuthBanner status={{ state: 'needs_reauth' }} checkCount={1} />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(/connection expired/i)).toBeInTheDocument();

    const reconnect = screen.getByRole('button', { name: /reconnect to upwork/i });
    expect(reconnect).toHaveAttribute('type', 'submit');
    // Top-level form POST so the OAuth 302 navigates the top window (CORS-safe).
    const form = reconnect.closest('form');
    expect(form?.getAttribute('action')).toBe('/api/upwork/connect');
    expect(form?.getAttribute('method')).toBe('post');
    expect(screen.getByRole('button', { name: /dismiss/i })).toHaveAttribute('type', 'button');
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
