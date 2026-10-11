import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpworkStatus } from './useUpworkStatus.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('useUpworkStatus', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('starts unknown, then resolves to the parsed status', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ state: 'connected', expiresAt: '2026-10-12T00:00:00Z' }),
    );
    const { result } = renderHook(() => useUpworkStatus({ intervalMs: 30_000 }));
    expect(result.current.status).toEqual({ state: 'unknown' });
    await waitFor(() => expect(result.current.status.state).toBe('connected'));
    expect(result.current.status).toEqual({ state: 'connected', expiresAt: '2026-10-12T00:00:00Z' });
    expect(result.current.checkCount).toBe(1);
  });

  it('404 (plan 03 not deployed yet) → unknown, not an error state', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ error: { code: 'not_found', message: 'resource not found' } }, 404),
    );
    const { result } = renderHook(() => useUpworkStatus({ intervalMs: 30_000 }));
    await waitFor(() => expect(result.current.checkCount).toBe(1));
    expect(result.current.status).toEqual({ state: 'unknown' });
  });

  it('network failure → unknown', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('failed to fetch'));
    const { result } = renderHook(() => useUpworkStatus({ intervalMs: 30_000 }));
    await waitFor(() => expect(result.current.checkCount).toBe(1));
    expect(result.current.status).toEqual({ state: 'unknown' });
  });

  it('unrecognized payload state → unknown', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ state: 'bogus' }));
    const { result } = renderHook(() => useUpworkStatus({ intervalMs: 30_000 }));
    await waitFor(() => expect(result.current.checkCount).toBe(1));
    expect(result.current.status).toEqual({ state: 'unknown' });
  });

  it('polls on the interval', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ state: 'connected' }));
    const { result, unmount } = renderHook(() => useUpworkStatus({ intervalMs: 30_000 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.current.checkCount).toBe(3);
    unmount();
  });

  it('re-checks immediately when the tab becomes visible', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ state: 'connected' }));
    const { unmount } = renderHook(() => useUpworkStatus({ intervalMs: 30_000 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('does not poll while disabled', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ state: 'connected' }));
    const { result, unmount } = renderHook(() => useUpworkStatus({ enabled: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.status).toEqual({ state: 'unknown' });
    unmount();
  });
});
