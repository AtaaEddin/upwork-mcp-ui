import { describe, expect, it } from 'vitest';
import {
  buildAcceptInvitationArgs,
  buildDeclineInvitationArgs,
  buildRespondOfferArgs,
  mapInvitations,
  mapOffers,
  parseWriteOutcome,
} from './invitations.js';

/**
 * Plan 07b mappers + write-outcome parser (defensive, D7.2/D7.6).
 */

describe('mapInvitations', () => {
  it('maps a bare array with flat fields', () => {
    const rows = mapInvitations([
      {
        invitation_id: 'inv-1',
        job_key: '~02jobdelta',
        job_id: '141',
        title: 'React dashboard',
        client_name: 'Delta',
        rate: '$60/hr',
        expires_at: '2026-10-20T00:00:00Z',
        status: 'Open',
      },
    ]);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.id).toBe('inv-1');
    expect(row?.jobNumericId).toBe('141');
    expect(row?.jobKey).toBe('~02jobdelta');
    expect(row?.jobTitle).toBe('React dashboard');
    expect(row?.clientName).toBe('Delta');
    expect(row?.terms).toBe('$60/hr');
    expect(row?.expires).toBe('2026-10-20T00:00:00Z');
    expect(row?.status).toBe('Open');
  });

  it('maps a named container and a nested job object', () => {
    const rows = mapInvitations({
      invitations: [
        {
          id: 21,
          job: { id: 152, title: 'Backend fix', client_name: 'Nested Co' },
        },
      ],
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.id).toBe('21');
    expect(row?.jobNumericId).toBe('152');
    expect(row?.jobKey).toBe('152');
    expect(row?.jobTitle).toBe('Backend fix');
    expect(row?.clientName).toBe('Nested Co');
  });

  it('degrades missing fields instead of throwing', () => {
    const rows = mapInvitations({ invitations: [{ something: 'odd' }, 'junk', 42] });
    expect(rows).toHaveLength(3);
    expect(rows[0]?.jobTitle).toBe('Invited job');
    expect(rows[0]?.jobKey).toBeNull();
    expect(rows[1]?.jobTitle).toBe('Invited job');
    expect(rows[2]?.jobTitle).toBe('Invited job');
  });

  it('returns an empty list for unknown shapes', () => {
    expect(mapInvitations(null)).toEqual([]);
    expect(mapInvitations('nope')).toEqual([]);
    expect(mapInvitations({})).toEqual([]);
  });
});

describe('mapOffers', () => {
  it('maps offers with hourly and fixed rates', () => {
    const rows = mapOffers({
      offers: [
        { id: 'off-1', title: 'A', hourly_rate: 55, client_name: 'A Co' },
        { id: 'off-2', job_title: 'B', fixed_price: 4200 },
        { id: 'off-3', title: 'C', terms: { hourly_rate: 70 } },
      ],
    });
    expect(rows.map((r) => r.hourlyRate)).toEqual(['$55', null, '$70']);
    expect(rows.map((r) => r.fixedPrice)).toEqual([null, '$4,200', null]);
    expect(rows.map((r) => r.id)).toEqual(['off-1', 'off-2', 'off-3']);
  });

  it('falls back to aliases and degrades', () => {
    const rows = mapOffers([{ offer_id: 9, job: { id: '77' }, budget: '3000–4000' }]);
    expect(rows[0]?.id).toBe('9');
    expect(rows[0]?.jobNumericId).toBe('77');
    // Non-numeric budget passes through as-is.
    expect(rows[0]?.fixedPrice).toBe('3000–4000');
  });

  it('returns an empty list for unknown shapes', () => {
    expect(mapOffers(null)).toEqual([]);
    expect(mapOffers({})).toEqual([]);
  });
});

describe('parseWriteOutcome', () => {
  it('detects finalize_url (binding step)', () => {
    const out = parseWriteOutcome({
      status: 'action_required',
      finalize_url: 'https://www.upwork.com/ab/2/x',
    });
    expect(out.kind).toBe('finalize');
    expect(out.finalizeUrl).toBe('https://www.upwork.com/ab/2/x');
  });

  it('detects action_required even without a url', () => {
    expect(parseWriteOutcome({ status: 'action_required' }).kind).toBe('finalize');
  });

  it('finalize wins over a preview in the same result', () => {
    const out = parseWriteOutcome({
      status: 'action_required',
      finalize_url: 'https://www.upwork.com/ab/2/x',
      preview_id: 'pv-1',
      type: 'offer_accept',
    });
    expect(out.kind).toBe('finalize');
  });

  it('detects a preview for the second confirm step', () => {
    const out = parseWriteOutcome({ preview_id: 'pv-9', type: 'offer_decline' });
    expect(out.kind).toBe('preview');
    expect(out.previewId).toBe('pv-9');
    expect(out.previewType).toBe('offer_decline');
  });

  it('detects a preview nested in a preview container', () => {
    const out = parseWriteOutcome({
      preview: { preview_id: 'pv-10', preview_type: 'invitation_accept' },
    });
    expect(out.kind).toBe('preview');
    expect(out.previewId).toBe('pv-10');
    expect(out.previewType).toBe('invitation_accept');
  });

  it('a plain id without preview_id is NOT a preview', () => {
    const out = parseWriteOutcome({ status: 'confirmed', id: '900', type: 'proposal' });
    // preview_type would match, but without preview_id it must not chain.
    expect(out.kind).toBe('ok');
  });

  it('surfaces needs_details (string or array)', () => {
    expect(parseWriteOutcome({ needs_details: 'job_id is required' }).kind).toBe(
      'needs_details',
    );
    const out = parseWriteOutcome({ needs_details: ['job_id', 'charged_amount'] });
    expect(out.kind).toBe('needs_details');
    expect(out.needsDetails).toBe('Missing fields: job_id, charged_amount');
  });

  it('treats everything else as a plain success', () => {
    expect(parseWriteOutcome({ status: 'ok' }).kind).toBe('ok');
    expect(parseWriteOutcome(null).kind).toBe('ok');
    expect(parseWriteOutcome({}).kind).toBe('ok');
  });
});

describe('invitation arg builders (D7.6 best-known names)', () => {
  it('prefers the numeric job_id', () => {
    expect(buildAcceptInvitationArgs({ id: 'inv-1', jobNumericId: '141' })).toEqual({
      job_id: '141',
    });
  });

  it('falls back to the invitation_id', () => {
    expect(buildAcceptInvitationArgs({ id: 'inv-1', jobNumericId: null })).toEqual({
      invitation_id: 'inv-1',
    });
    expect(buildDeclineInvitationArgs({ id: null, jobNumericId: null })).toEqual({});
  });

  it('decline carries the reason only when given', () => {
    expect(buildDeclineInvitationArgs({ id: 'inv-1', jobNumericId: null }, 'Not a fit')).toEqual({
      invitation_id: 'inv-1',
      reason: 'Not a fit',
    });
    expect(buildDeclineInvitationArgs({ id: 'inv-1', jobNumericId: null }, '   ')).toEqual({
      invitation_id: 'inv-1',
    });
  });
});

describe('offer arg builders', () => {
  it('sends offer_id + job_id and the message only for request_changes', () => {
    expect(buildRespondOfferArgs({ id: 'off-1', jobNumericId: '11' }, 'accept')).toEqual({
      offer_id: 'off-1',
      job_id: '11',
    });
    expect(buildRespondOfferArgs({ id: 'off-1', jobNumericId: null }, 'decline')).toEqual({
      offer_id: 'off-1',
    });
    expect(
      buildRespondOfferArgs({ id: 'off-1', jobNumericId: null }, 'request_changes', 'More time'),
    ).toEqual({ offer_id: 'off-1', message: 'More time' });
    expect(buildRespondOfferArgs({ id: 'off-1', jobNumericId: null }, 'request_changes', '  ')).toEqual(
      { offer_id: 'off-1' },
    );
    expect(buildRespondOfferArgs({ id: null, jobNumericId: null }, 'accept')).toEqual({});
  });
});
