import { describe, expect, it } from 'vitest';
import {
  buildConfirmArgs,
  buildCreateArgs,
  canConfirmPreview,
  clientFeedbackOf,
  highlightsOf,
  invitationsOf,
  jobNumericIdOf,
  mapProposalDetail,
  mapProposals,
  matchesJob,
  needsDetailsOf,
  parseConfirmResult,
  parsePreview,
  screeningQuestionsOf,
} from './proposals.js';

describe('mapProposals', () => {
  it('maps a documented nested list with status_label and terms', () => {
    const rows = mapProposals({
      proposals: [
        {
          id: '900',
          job_key: '~02jobalpha',
          title: 'Senior React developer',
          client_name: 'Acme',
          status: 'Pending',
          status_label: 'Submitted',
          terms: { charged_amount: 3000 },
          posted_at: '2026-10-11T10:00:00Z',
        },
      ],
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.id).toBe('900');
    expect(row?.title).toBe('Senior React developer');
    expect(row?.clientName).toBe('Acme');
    expect(row?.status).toBe('Pending');
    expect(row?.statusLabel).toBe('Submitted');
    expect(row?.bid).toBe('$3,000');
    expect(row?.posted).toBe('2026-10-11T10:00:00Z');
    expect(row?.jobKey).toBe('~02jobalpha');
  });

  it('finds items in alias containers and falls back to title/Key defaults', () => {
    const rows = mapProposals({
      items: [
        { proposal_id: 12, job: { id: 55 }, bid: 120 },
        { title: 'Only a title' },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe('12');
    expect(rows[0]?.jobKey).toBe('55');
    expect(rows[0]?.bid).toBe('$120');
    expect(rows[1]?.title).toBe('Only a title');
  });

  it('skips non-object items and returns empty for unknown shapes', () => {
    expect(mapProposals(null)).toEqual([]);
    expect(mapProposals('nope')).toEqual([]);
    expect(mapProposals({ proposals: ['nope', null, 42] })).toEqual([]);
  });
});

describe('mapProposalDetail', () => {
  it('maps terms, screening, and attachments', () => {
    const d = mapProposalDetail({
      proposal: {
        status: 'Accepted',
        status_label: 'Submitted & validated',
        job_title: 'React job',
        job_key: '~02abc',
        url: 'https://www.upwork.com/jobs/~02abc',
        client_name: 'Client Co',
        terms: { charged_amount: 1500, connects_bid: 5 },
        cover_letter: 'Hi…',
        screening_answers: [
          { question: 'Q1', answer: 'A1' },
          { question: 'Q2', answer: 'A2' },
        ],
        attachments: ['a.pdf'],
      },
    });
    expect(d).not.toBeNull();
    expect(d?.statusLabel).toBe('Submitted & validated');
    expect(d?.chargedAmount).toBe('$1,500');
    expect(d?.connectsBid).toBe('5');
    expect(d?.coverLetter).toBe('Hi…');
    expect(d?.screening).toEqual([
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2' },
    ]);
    expect(d?.attachments).toEqual(['a.pdf']);
    expect(d?.jobKey).toBe('~02abc');
  });

  it('returns null for non-record input', () => {
    expect(mapProposalDetail(null)).toBeNull();
    expect(mapProposalDetail('x')).toBeNull();
  });
});

describe('buildCreateArgs', () => {
  it('always carries job_id and charged_amount', () => {
    const args = buildCreateArgs({
      jobNumericId: '111',
      chargedAmount: 3000,
      coverLetter: '  hello  ',
      screeningAnswers: [{ question: 'Q1', answer: 'A1' }],
      portfolioProjectIds: ['pp-1'],
      certificateIds: [],
    });
    expect(args).toMatchObject({
      job_id: '111',
      charged_amount: 3000,
      cover_letter: 'hello',
      screening_answers: [{ question: 'Q1', answer: 'A1' }],
      portfolio_project_ids: ['pp-1'],
    });
    expect(args).not.toHaveProperty('certificate_ids');
  });

  it('omits empty optional fields', () => {
    const args = buildCreateArgs({
      jobNumericId: null,
      chargedAmount: 100,
      coverLetter: '   ',
      screeningAnswers: [],
      portfolioProjectIds: [],
      certificateIds: [],
    });
    expect(args).toEqual({ job_id: null, charged_amount: 100 });
  });
});

describe('parsePreview', () => {
  it('parses preview_id, type, costs, eligibility, boost, and screening', () => {
    const p = parsePreview({
      preview_id: 'pv-1',
      type: 'proposal',
      connects_required: 10,
      connects_balance: 12,
      unmet_qualifications: ['AWS'],
      required_screening: ['Q1'],
      competing_bids: '5 bids',
      boost: {
        available: true,
        max_connects: 20,
        suggested_bid: 5,
        recommendation: 'consider',
      },
    });
    expect(p.previewId).toBe('pv-1');
    expect(p.type).toBe('proposal');
    expect(p.connectsRequired).toBe(10);
    expect(p.connectsBalance).toBe(12);
    expect(p.eligible).toBeNull();
    expect(p.unmetQualifications).toEqual(['AWS']);
    expect(p.requiredScreening).toEqual(['Q1']);
    expect(p.competingBids).toBe('5 bids');
    expect(p.boost).toEqual({
      available: true,
      limit: 20,
      suggestedBid: 5,
      recommendation: 'consider',
      reason: null,
    });
  });

  it('parses explicit ineligibility and nested preview containers', () => {
    const p = parsePreview({
      preview: { preview_id: 'pv-2' },
      eligible: false,
      reason: 'not allowed here',
      boost: null,
    });
    expect(p.previewId).toBe('pv-2');
    expect(p.eligible).toBe(false);
    expect(p.eligibilityNote).toBe('not allowed here');
    expect(p.boost).toBeNull();
  });

  it('treats unknown shapes as empty previews, never throws', () => {
    const p = parsePreview(null);
    expect(p.previewId).toBeNull();
    expect(p.type).toBeNull();
    const p2 = parsePreview({ weird: true });
    expect(canConfirmPreview(p2)).toBe(false);
  });
});

describe('canConfirmPreview', () => {
  it('requires a non-empty preview_id AND type', () => {
    expect(canConfirmPreview({ previewId: 'pv', type: 'proposal' })).toBe(true);
    expect(canConfirmPreview({ previewId: null, type: 'proposal' })).toBe(false);
    expect(canConfirmPreview({ previewId: 'pv', type: null })).toBe(false);
    expect(canConfirmPreview({ previewId: '  ', type: 'proposal' })).toBe(false);
    expect(canConfirmPreview({ previewId: 'pv', type: '' })).toBe(false);
  });
});

describe('buildConfirmArgs', () => {
  it('sends type + preview_id and boost only when positive', () => {
    expect(
      buildConfirmArgs({ previewId: 'pv-1', type: 'proposal' }, null),
    ).toEqual({ type: 'proposal', preview_id: 'pv-1' });
    expect(
      buildConfirmArgs({ previewId: 'pv-1', type: 'proposal' }, 0),
    ).toEqual({ type: 'proposal', preview_id: 'pv-1' });
    expect(
      buildConfirmArgs({ previewId: 'pv-1', type: 'proposal' }, 5),
    ).toEqual({ type: 'proposal', preview_id: 'pv-1', boost_connects: 5 });
  });
});

describe('needsDetailsOf', () => {
  it('extracts strings, string arrays, and field objects', () => {
    expect(needsDetailsOf({ needs_details: 'Missing: cover_letter' })).toBe(
      'Missing: cover_letter',
    );
    expect(needsDetailsOf({ needs_details: ['cover_letter', 'bid'] })).toBe(
      'Missing fields: cover_letter, bid',
    );
    expect(needsDetailsOf({ needs_details: [{ field: 'bid' }, { name: 'cover_letter' }] })).toBe(
      'Missing fields: bid, cover_letter',
    );
    expect(needsDetailsOf(null)).toBeNull();
    expect(needsDetailsOf({})).toBeNull();
    expect(needsDetailsOf({ needs_details: '   ' })).toBeNull();
  });
});

describe('matchesJob', () => {
  const ids = ['111', '~02abc'];
  it('matches any known identifier form, incl. nested job records', () => {
    expect(matchesJob({ id: '111' }, ids)).toBe(true);
    expect(matchesJob({ job_id: '~02abc' }, ids)).toBe(true);
    expect(matchesJob({ job: { id: '111' } }, ids)).toBe(true);
    expect(matchesJob({ url: 'https://upwork.com/jobs/~02abc' }, ['https://upwork.com/jobs/~02abc'])).toBe(true);
  });
  it('does not match unrelated items or empty identifiers', () => {
    expect(matchesJob({ id: '999' }, ids)).toBe(false);
    expect(matchesJob(null, ids)).toBe(false);
    expect(matchesJob({ id: '111' }, [])).toBe(false);
  });
});

describe('invitationsOf', () => {
  it('finds the invitation list in documented or alias containers', () => {
    expect(invitationsOf({ invitations: [{ id: 1 }, { id: 2 }] })).toHaveLength(2);
    expect(invitationsOf([{ id: 1 }])).toHaveLength(1);
    expect(invitationsOf({ results: [{ id: 1 }] })).toHaveLength(1);
    expect(invitationsOf(null)).toEqual([]);
    expect(invitationsOf({ nothing: true })).toEqual([]);
  });
});

describe('jobNumericIdOf', () => {
  it('extracts the numeric id from a find_jobs get payload', () => {
    expect(jobNumericIdOf({ job: { id: '12345' } })).toBe('12345');
    expect(jobNumericIdOf({ job: { id: '~02abc', id_numeric: 77 } })).toBe('77');
    expect(jobNumericIdOf({ id: '~02abc' })).toBeNull();
    expect(jobNumericIdOf(null)).toBeNull();
  });
});

describe('screeningQuestionsOf', () => {
  it('reads string or object questions', () => {
    expect(
      screeningQuestionsOf({
        job: { screening_questions: ['Q1', { question: 'Q2' }, '  ', null] },
      }),
    ).toEqual(['Q1', 'Q2']);
    expect(screeningQuestionsOf(null)).toEqual([]);
  });
});

describe('clientFeedbackOf', () => {
  it('reads string or object feedback', () => {
    expect(clientFeedbackOf({ job: { client_feedback: 'Top client' } })).toBe('Top client');
    expect(
      clientFeedbackOf({
        job: { client_feedback: { feedback: '98% job success' } },
      }),
    ).toBe('98% job success');
    expect(clientFeedbackOf(null)).toBeNull();
  });
});

describe('highlightsOf', () => {
  it('maps portfolio projects and certificates with ids', () => {
    const h = highlightsOf({
      portfolio_projects: [
        { id: 'pp-1', title: 'Dashboard' },
        { title: 'No id' },
        { id: 'pp-2' },
      ],
      certificates: [{ id: 'cert-1', title: 'AWS' }],
    });
    expect(h.projects).toEqual([
      { id: 'pp-1', title: 'Dashboard' },
      { id: 'pp-2', title: 'pp-2' },
    ]);
    expect(h.certificates).toEqual([{ id: 'cert-1', title: 'AWS' }]);
  });

  it('returns empty for unknown shapes', () => {
    expect(highlightsOf(null)).toEqual({ projects: [], certificates: [] });
    expect(highlightsOf('x')).toEqual({ projects: [], certificates: [] });
  });
});

describe('parseConfirmResult', () => {
  it('reads status and finalize_url (both spellings)', () => {
    expect(
      parseConfirmResult({ status: 'action_required', finalize_url: 'https://upwork.com/f' }),
    ).toEqual({ status: 'action_required', finalizeUrl: 'https://upwork.com/f' });
    expect(parseConfirmResult({ finalizeUrl: 'https://x' })).toEqual({
      status: null,
      finalizeUrl: 'https://x',
    });
    expect(parseConfirmResult(null)).toEqual({ status: null, finalizeUrl: null });
  });
});
