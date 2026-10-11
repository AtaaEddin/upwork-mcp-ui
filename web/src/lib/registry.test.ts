import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api.js';
import { fetchMock, jsonResponse, type FetchRoute } from '../test/fetchMock.js';
import {
  FEATURES,
  callFeature,
  featureErrorMessage,
  liveToolNames,
  parseToolData,
  resolveTool,
} from './registry.js';

describe('liveToolNames (plan 06)', () => {
  it('collects tool names from a tools list', () => {
    const names = liveToolNames([
      { name: 'a', inputSchema: { type: 'object' } },
      { name: 'b' },
    ]);
    expect(names.has('a')).toBe(true);
    expect(names.has('b')).toBe(true);
    expect(names.has('c')).toBe(false);
  });
});

describe('resolveTool (plan 06)', () => {
  it('picks the first live candidate, or null when none are live', () => {
    expect(resolveTool(FEATURES.jobsSearch, ['upwork__list_jobs'])).toBeNull();
    expect(resolveTool(FEATURES.jobsSearch, ['upwork__find_jobs', 'upwork__other'])).toBe(
      'upwork__find_jobs',
    );
    expect(resolveTool(FEATURES.invitations, [])).toBeNull();
  });
});

describe('parseToolData (plan 06)', () => {
  it('prefers structuredContent', () => {
    const out = parseToolData({
      isError: false,
      ms: 1,
      content: [{ type: 'text', text: '{"ignored":true}' }],
      structuredContent: { hello: 1 },
    });
    expect(out).toEqual({ hello: 1 });
  });

  it('JSON-parses a JSON text part', () => {
    const out = parseToolData({
      isError: false,
      ms: 1,
      content: [{ type: 'text', text: '[1, 2]' }],
    });
    expect(out).toEqual([1, 2]);
  });

  it('returns raw text for non-JSON and null for empty', () => {
    expect(
      parseToolData({ isError: false, ms: 1, content: [{ type: 'text', text: 'plain text' }] }),
    ).toEqual({ text: 'plain text' });
    expect(parseToolData({ isError: false, ms: 1, content: [] })).toBeNull();
  });
});

describe('callFeature (plan 06)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('injects action and org_uid, returns parsed data', async () => {
    let captured: unknown = null;
    const routes: Record<string, FetchRoute> = {
      '/api/tools/upwork__get_profile/call': async (req) => {
        captured = JSON.parse(await req.text()) as unknown;
        return jsonResponse({
          isError: false,
          ms: 3,
          content: [],
          structuredContent: { balance: 5 },
        });
      },
    };
    vi.stubGlobal('fetch', fetchMock(routes));

    const data = await callFeature(FEATURES.connects, 'upwork__get_profile', 'org-1');
    expect(captured).toEqual({ args: { action: 'connects_balance', org_uid: 'org-1' } });
    expect(data).toEqual({ balance: 5 });
  });

  it('throws the tool text when isError is true', async () => {
    const routes: Record<string, FetchRoute> = {
      '/api/tools/upwork__find_jobs/call': () =>
        jsonResponse({
          isError: true,
          ms: 2,
          content: [{ type: 'text', text: 'No permission for this action' }],
        }),
    };
    vi.stubGlobal('fetch', fetchMock(routes));

    await expect(callFeature(FEATURES.jobGet, 'upwork__find_jobs', 'org-1', { id: '~02x' })).rejects.toThrow(
      'No permission for this action',
    );
  });

  it('throws a generic message when isError carries no text', async () => {
    const routes: Record<string, FetchRoute> = {
      '/api/tools/upwork__find_jobs/call': () =>
        jsonResponse({ isError: true, ms: 2, content: [] }),
    };
    vi.stubGlobal('fetch', fetchMock(routes));

    await expect(callFeature(FEATURES.jobGet, 'upwork__find_jobs', 'org-1')).rejects.toThrow(
      'The Upwork tool reported an error.',
    );
  });
});

describe('featureErrorMessage (plan 06)', () => {
  it('surfaces Error messages and null for other values', () => {
    expect(featureErrorMessage(new Error('boom'))).toBe('boom');
    expect(featureErrorMessage(new ApiError(429, 'rate_limited', 'Slow down, please'))).toBe(
      'Upwork rate limit reached — retry in about 30s.',
    );
    expect(featureErrorMessage(new ApiError(502, 'upstream_error', 'Upstream failed'))).toBe(
      'Upstream failed',
    );
    expect(featureErrorMessage(42)).toBeNull();
  });
});
