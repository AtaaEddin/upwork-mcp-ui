import { describe, expect, it } from 'vitest';
import {
  buildGetArgs,
  buildSearchArgs,
  buildSmartArgs,
  EMPTY_FILTERS,
  isPlaceholderJobKey,
  mapJobDetail,
  mapJobResult,
  type JobFilters,
} from './jobs.js';

describe('buildSearchArgs (plan 06)', () => {
  it('sends only action+org_uid for empty filters', () => {
    expect(buildSearchArgs(EMPTY_FILTERS, 'org-1')).toEqual({
      action: 'search',
      org_uid: 'org-1',
    });
  });

  it('adds query/category/budget/type when set, and echoes the page values', () => {
    const filters: JobFilters = {
      query: 'react',
      category: 'Engineering',
      budgetMin: '50',
      budgetMax: '100',
      jobType: 'fixed',
    };
    expect(buildSearchArgs(filters, 'org-1', { page: 2, limit: 20 })).toEqual({
      action: 'search',
      org_uid: 'org-1',
      query: 'react',
      category: 'Engineering',
      budget_min: 50,
      budget_max: 100,
      job_type: 'fixed',
      page: 2,
      limit: 20,
    });
  });

  it('drops invalid budgets and whitespace-only text', () => {
    const filters: JobFilters = {
      query: '   ',
      category: '',
      budgetMin: 'abc',
      budgetMax: '',
      jobType: 'any',
    };
    expect(buildSearchArgs(filters, 'org-1')).toEqual({ action: 'search', org_uid: 'org-1' });
  });
});

describe('buildSmartArgs / buildGetArgs (plan 06)', () => {
  it('builds smart_search args with default mode and page echo', () => {
    expect(buildSmartArgs('org-1')).toEqual({
      action: 'smart_search',
      org_uid: 'org-1',
      mode: 'best_match',
    });
    expect(buildSmartArgs('org-1', 'most_recent', { page: 3 })).toEqual({
      action: 'smart_search',
      org_uid: 'org-1',
      mode: 'most_recent',
      page: 3,
    });
  });

  it('passes the job key through unchanged (numeric, ciphertext, URL)', () => {
    expect(buildGetArgs('~02abc', 'org-1')).toEqual({
      action: 'get',
      org_uid: 'org-1',
      id: '~02abc',
    });
    expect(buildGetArgs('123456789', 'org-1')).toEqual({
      action: 'get',
      org_uid: 'org-1',
      id: '123456789',
    });
    expect(buildGetArgs('https://www.upwork.com/jobs/~02abc', 'org-1')).toEqual({
      action: 'get',
      org_uid: 'org-1',
      id: 'https://www.upwork.com/jobs/~02abc',
    });
  });

  it('trims the key and returns null for empty/whitespace keys (no call without id)', () => {
    expect(buildGetArgs('  ~02abc ', 'org-1')).toEqual({
      action: 'get',
      org_uid: 'org-1',
      id: '~02abc',
    });
    expect(buildGetArgs('', 'org-1')).toBeNull();
    expect(buildGetArgs('   ', 'org-1')).toBeNull();
  });
});

describe('isPlaceholderJobKey (plan 10)', () => {
  it('recognizes the row-N placeholder convention and nothing else', () => {
    expect(isPlaceholderJobKey('row-0')).toBe(true);
    expect(isPlaceholderJobKey('row-12')).toBe(true);
    expect(isPlaceholderJobKey(' row-3 ')).toBe(true);
    expect(isPlaceholderJobKey('~02abc')).toBe(false);
    expect(isPlaceholderJobKey('123456789')).toBe(false);
    expect(isPlaceholderJobKey('row-3/propose')).toBe(false);
    expect(isPlaceholderJobKey('row-x')).toBe(false);
    expect(isPlaceholderJobKey('')).toBe(false);
  });
});

const SEARCH_RESULT = {
  jobs: [
    {
      id: '12345',
      title: 'Build a React dashboard',
      fixed_price: { min: 500, max: 1000 },
      skills: ['React', 'TypeScript'],
      client: { name: 'Acme', rating: 4.8, num_contracts: 32, location: 'United States' },
      posted_at: '2026-10-01T00:00:00Z',
      applied: true,
    },
    {
      job_key: '~02abc',
      job_title: 'Backend API work',
      hourly_rate: 60,
      categories: ['API'],
      client_name: 'Globex',
    },
  ],
  total: 120,
  page: 1,
  limit: 20,
  next_page: 2,
  filters_ignored: ['category:foo'],
};

describe('mapJobResult (plan 06)', () => {
  it('maps rows with defensive field lookups', () => {
    const res = mapJobResult(SEARCH_RESULT);
    expect(res.rows).toHaveLength(2);

    const [a, b] = res.rows;
    expect(a?.title).toBe('Build a React dashboard');
    expect(a?.jobKey).toBe('12345');
    expect(a?.budget).toBe('Fixed: $500 – $1000');
    expect(a?.skills).toEqual(['React', 'TypeScript']);
    expect(a?.client).toBe('Acme');
    expect(a?.clientMeta).toBe('★ 4.8 · 32 contracts · United States');
    expect(a?.applied).toBe(true);

    // Ciphertext ids are preferred over numeric ids (the safest `get` input).
    expect(b?.jobKey).toBe('~02abc');
    expect(b?.title).toBe('Backend API work');
    expect(b?.budget).toBe('$60/hr');
    expect(b?.client).toBe('Globex');
    expect(b?.applied).toBe(false);
  });

  it('reads server feedback: empty_reason, filters_ignored, needs_details', () => {
    const empty = mapJobResult({ empty_reason: 'No jobs match your filters' });
    expect(empty.rows).toHaveLength(0);
    expect(empty.meta.emptyReason).toBe('No jobs match your filters');

    const ignored = mapJobResult(SEARCH_RESULT);
    expect(ignored.meta.filtersIgnored).toEqual(['category:foo']);

    const needs = mapJobResult({ jobs: [], needs_details: 'Please specify a budget range' });
    expect(needs.meta.needsDetails).toBe('Please specify a budget range');
  });

  it('echoes pagination values and has_more', () => {
    const res = mapJobResult(SEARCH_RESULT);
    expect(res.meta.nextPage).toEqual({ page: 1, limit: 20, next_page: 2 });
    expect(res.meta.hasMore).toBe(true);
    expect(res.meta.total).toBe(120);

    const last = mapJobResult({ jobs: [{ title: 'x' }], has_more: false });
    expect(last.meta.nextPage).toBeNull();
    expect(last.meta.hasMore).toBe(false);
  });

  it('keeps rows with no recognizable reference under a row-N placeholder key (plan 10)', () => {
    const res = mapJobResult({
      jobs: [
        { title: 'No reference anywhere', budget: 10 },
        { job_title: 'Also no reference' },
      ],
    });
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]?.jobKey).toBe('row-0');
    expect(res.rows[1]?.jobKey).toBe('row-1');
    expect(res.rows[0]?.title).toBe('No reference anywhere');
    expect(res.rows[1]?.title).toBe('Also no reference');
  });

  it('handles arrays at the top level and garbage gracefully', () => {
    const arr = mapJobResult([{ title: 'Solo job', fixed_price: 10 }]);
    expect(arr.rows).toHaveLength(1);
    expect(arr.rows[0]?.budget).toBe('Fixed: $10');

    const garbage = mapJobResult('nope');
    expect(garbage.rows).toEqual([]);
    const nullCase = mapJobResult(null);
    expect(nullCase.rows).toEqual([]);
  });
});

const DETAIL = {
  job: {
    id: '12345',
    job_key: '~02abc',
    title: 'Build a React dashboard',
    url: 'https://www.upwork.com/jobs/~02abc',
    fixed_price: { min: 500, max: 1000 },
    connects_cost: 3,
    posted_at: '2026-10-01T00:00:00Z',
    client: { name: 'Acme', rating: 4.9 },
    description: 'We need a React expert.',
    screening_questions: [{ question: 'Why you?' }, 'Years of experience?'],
    requirements: ['5+ years of React'],
    skills: ['React', 'Vite'],
    applied: false,
  },
};

describe('mapJobDetail (plan 06)', () => {
  it('maps the detail payload (unwrapping `job`) and keeps the raw data', () => {
    const d = mapJobDetail(DETAIL, 'fallback');
    expect(d?.title).toBe('Build a React dashboard');
    expect(d?.jobKey).toBe('~02abc');
    expect(d?.connectsCost).toBe(3);
    expect(d?.budget).toBe('Fixed: $500 – $1000');
    expect(d?.description).toBe('We need a React expert.');
    expect(d?.requirements).toEqual(['Why you?', 'Years of experience?', '5+ years of React']);
    expect(d?.applied).toBe(false);
    expect(d?.raw).toBe(DETAIL);
  });

  it('returns null for non-object payloads and falls back to the route key', () => {
    expect(mapJobDetail([], 'k')).toBeNull();
    expect(mapJobDetail(null, 'k')).toBeNull();
    const flat = mapJobDetail({ title: 'Flat job' }, 'route-key');
    expect(flat?.title).toBe('Flat job');
    expect(flat?.jobKey).toBe('route-key');
  });
});
