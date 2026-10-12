import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fetchMock, jsonResponse, type FetchRoute } from '../test/fetchMock.js';
import { OfferActions } from './OfferActions.js';

/**
 * Offer accept/decline/request-changes (plan 07b, D7.6): accept is
 * binding (finalize link); decline + request-changes are previews →
 * second confirm step; everything behind an explicit confirm.
 */

interface Scenario {
  accept?: unknown;
  decline?: unknown;
  requestChanges?: unknown;
  confirm?: unknown;
}

const OFFER = { id: 'off-1', jobNumericId: '11', jobTitle: 'React dashboard' };

function makeRoutes(
  scenario: Scenario,
  calls: Array<{ tool: string; args: Record<string, unknown> }>,
) {
  const respond: FetchRoute = async (req) => {
    const body = (await req.json()) as { args: Record<string, unknown> };
    calls.push({ tool: 'upwork__respond_to_offer', args: body.args });
    const action = body.args.action as string;
    const content =
      action === 'decline'
        ? (scenario.decline ?? { status: 'ok' })
        : action === 'request_changes'
          ? (scenario.requestChanges ?? { status: 'ok' })
          : (scenario.accept ?? { status: 'ok' });
    return jsonResponse({ isError: false, ms: 1, content: [], structuredContent: content });
  };
  const confirm: FetchRoute = async (req) => {
    const body = (await req.json()) as { args: Record<string, unknown> };
    calls.push({ tool: 'upwork__confirm_preview', args: body.args });
    return jsonResponse({
      isError: false,
      ms: 1,
      content: [],
      structuredContent: scenario.confirm ?? { status: 'confirmed' },
    });
  };
  return {
    '/api/tools/upwork__respond_to_offer/call': respond,
    '/api/tools/upwork__confirm_preview/call': confirm,
  } as const;
}

function renderActions(scenario: Scenario = {}) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  vi.stubGlobal('fetch', fetchMock(makeRoutes(scenario, calls)));
  const onDone = vi.fn();
  render(
    <OfferActions
      offer={OFFER}
      orgUid="org-1"
      live={new Set(['upwork__respond_to_offer', 'upwork__confirm_preview'])}
      onDone={onDone}
    />,
  );
  return { calls, onDone };
}

const dialogButton = (name: string): HTMLElement =>
  within(screen.getByRole('dialog')).getByRole('button', { name });

describe('OfferActions (plan 07b)', () => {
  it('accept is binding: confirm, then the finalize link', async () => {
    const { calls, onDone } = renderActions({
      accept: { status: 'action_required', finalize_url: 'https://www.upwork.com/ab/2/y' },
    });

    fireEvent.click(screen.getByRole('button', { name: /accept offer/i }));
    await screen.findByText(/accepting is a binding action/i);
    expect(calls).toHaveLength(0);

    fireEvent.click(dialogButton('Accept'));
    await waitFor(() =>
      expect(calls.some((c) => c.tool === 'upwork__respond_to_offer')).toBe(true),
    );
    const respond = calls.find((c) => c.tool === 'upwork__respond_to_offer');
    expect(respond?.args).toEqual({ action: 'accept', offer_id: 'off-1', job_id: '11', org_uid: 'org-1' });

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('link', { name: /finish on upwork\.com/i }),
    ).toHaveAttribute('href', 'https://www.upwork.com/ab/2/y');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('decline is a preview: step 1 → second confirm → done + refresh', async () => {
    const { calls, onDone } = renderActions({
      decline: { preview_id: 'pv-d', type: 'offer_decline' },
      confirm: { status: 'confirmed' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));
    await screen.findByRole('dialog');
    expect(screen.getByRole('dialog')).toHaveTextContent(/second step/i);
    fireEvent.click(dialogButton('Decline'));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveTextContent(/stored this as a preview/i);
    });
    expect(calls.filter((c) => c.tool === 'upwork__confirm_preview')).toHaveLength(0);

    fireEvent.click(dialogButton('Confirm'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const confirmCall = calls.find((c) => c.tool === 'upwork__confirm_preview');
    expect(confirmCall?.args).toEqual({
      action: 'confirm',
      org_uid: 'org-1',
      type: 'offer_decline',
      preview_id: 'pv-d',
    });
  });

  it('request changes sends the message and confirms the preview', async () => {
    const { calls, onDone } = renderActions({
      requestChanges: { preview_id: 'pv-r', type: 'offer_request_changes' },
      confirm: { status: 'confirmed' },
    });

    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'I can take this on at $55/h.' },
    });
    fireEvent.click(dialogButton('Send request'));

    const respond = await waitFor(() => {
      const c = calls.find((x) => x.tool === 'upwork__respond_to_offer');
      expect(c?.args).toMatchObject({ action: 'request_changes' });
      return c;
    });
    expect(respond?.args).toEqual({
      action: 'request_changes',
      offer_id: 'off-1',
      job_id: '11',
      message: 'I can take this on at $55/h.',
      org_uid: 'org-1',
    });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveTextContent(/stored this as a preview/i);
    });
    fireEvent.click(dialogButton('Confirm'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('request changes without a message omits the message arg', async () => {
    const { calls } = renderActions({
      requestChanges: { preview_id: 'pv-r', type: 'offer_request_changes' },
      confirm: { status: 'confirmed' },
    });

    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));
    await screen.findByRole('dialog');
    fireEvent.click(dialogButton('Send request'));
    const respond = await waitFor(() => {
      const c = calls.find((x) => x.tool === 'upwork__respond_to_offer');
      expect(c).toBeDefined();
      return c;
    });
    expect(respond?.args).toEqual({
      action: 'request_changes',
      offer_id: 'off-1',
      job_id: '11',
      org_uid: 'org-1',
    });
  });

  it('surfaces needs_details verbatim from the preview step', async () => {
    const { calls, onDone } = renderActions({
      decline: { needs_details: 'offer_id is required' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));
    await screen.findByRole('dialog');
    fireEvent.click(dialogButton('Decline'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('offer_id is required');
    expect(onDone).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.tool === 'upwork__confirm_preview')).toHaveLength(0);
  });
});
