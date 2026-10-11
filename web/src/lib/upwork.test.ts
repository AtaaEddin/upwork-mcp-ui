import { describe, expect, it } from 'vitest';
import {
  connectionDotClass,
  connectionLabel,
  connectionShortLabel,
  parseUpworkStatus,
  shouldShowReAuthBanner,
} from './upwork.js';

describe('parseUpworkStatus', () => {
  it('accepts each connection state', () => {
    for (const state of ['connected', 'connecting', 'disconnected', 'needs_reauth'] as const) {
      expect(parseUpworkStatus({ state })).toEqual({ state });
    }
  });

  it('keeps optional string fields', () => {
    const status = parseUpworkStatus({
      state: 'connected',
      expiresAt: '2026-10-12T00:00:00Z',
      accountSummary: 'freelancer@upwork.com',
    });
    expect(status).toEqual({
      state: 'connected',
      expiresAt: '2026-10-12T00:00:00Z',
      accountSummary: 'freelancer@upwork.com',
    });
  });

  it('drops optional fields that are not strings', () => {
    const status = parseUpworkStatus({ state: 'connected', expiresAt: 42 });
    expect(status).toEqual({ state: 'connected' });
  });

  it('returns unknown for garbage payloads', () => {
    expect(parseUpworkStatus(null)).toEqual({ state: 'unknown' });
    expect(parseUpworkStatus(undefined)).toEqual({ state: 'unknown' });
    expect(parseUpworkStatus('connected')).toEqual({ state: 'unknown' });
    expect(parseUpworkStatus({})).toEqual({ state: 'unknown' });
    expect(parseUpworkStatus({ state: 'bogus' })).toEqual({ state: 'unknown' });
    expect(parseUpworkStatus({ state: 5 })).toEqual({ state: 'unknown' });
  });
});

describe('shouldShowReAuthBanner', () => {
  it('shows only on explicit needs_reauth/disconnected', () => {
    expect(shouldShowReAuthBanner({ state: 'needs_reauth' }, false)).toBe(true);
    expect(shouldShowReAuthBanner({ state: 'disconnected' }, false)).toBe(true);
    expect(shouldShowReAuthBanner({ state: 'connected' }, false)).toBe(false);
    expect(shouldShowReAuthBanner({ state: 'connecting' }, false)).toBe(false);
    // No false re-auth prompt while the plan-03 endpoint is absent/down.
    expect(shouldShowReAuthBanner({ state: 'unknown' }, false)).toBe(false);
  });

  it('dismiss hides the banner', () => {
    expect(shouldShowReAuthBanner({ state: 'needs_reauth' }, true)).toBe(false);
    expect(shouldShowReAuthBanner({ state: 'disconnected' }, true)).toBe(false);
    // Dismiss is a no-op when nothing would show anyway.
    expect(shouldShowReAuthBanner({ state: 'connected' }, true)).toBe(false);
  });
});

describe('connection labels', () => {
  it('labels every state', () => {
    expect(connectionLabel({ state: 'connected' })).toBe('Connected to Upwork');
    expect(connectionLabel({ state: 'connecting' })).toBe('Connecting to Upwork…');
    expect(connectionLabel({ state: 'needs_reauth' })).toBe('Upwork needs re-authentication');
    expect(connectionLabel({ state: 'disconnected' })).toBe('Not connected to Upwork');
    expect(connectionLabel({ state: 'unknown' })).toBe('Upwork status unknown');
  });

  it('short labels for the pill', () => {
    expect(connectionShortLabel({ state: 'connected' })).toBe('Connected');
    expect(connectionShortLabel({ state: 'needs_reauth' })).toBe('Re-auth');
    expect(connectionShortLabel({ state: 'disconnected' })).toBe('Disconnected');
    expect(connectionShortLabel({ state: 'unknown' })).toBe('…');
  });

  it('dot classes: green/red/gray as specified', () => {
    expect(connectionDotClass({ state: 'connected' })).toContain('bg-up-green');
    expect(connectionDotClass({ state: 'needs_reauth' })).toContain('bg-up-red');
    expect(connectionDotClass({ state: 'disconnected' })).toContain('bg-gray-400');
    expect(connectionDotClass({ state: 'unknown' })).toContain('bg-gray-400');
  });
});
