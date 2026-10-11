import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusPill } from './StatusPill.js';
import type { UpworkStatus } from '../lib/upwork.js';

const CASES: Array<[UpworkStatus, string]> = [
  [{ state: 'connected' }, 'Connected to Upwork'],
  [{ state: 'connecting' }, 'Connecting to Upwork…'],
  [{ state: 'needs_reauth' }, 'Upwork needs re-authentication'],
  [{ state: 'disconnected' }, 'Not connected to Upwork'],
  [{ state: 'unknown' }, 'Upwork status unknown'],
];

describe('StatusPill', () => {
  it.each(CASES)('exposes the label %s via accessible name', (status, label) => {
    render(<StatusPill status={status} />);
    expect(screen.getByRole('status', { name: label })).toBeInTheDocument();
  });
});
