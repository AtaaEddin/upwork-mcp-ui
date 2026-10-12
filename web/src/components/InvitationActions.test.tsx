import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fetchMock, jsonResponse, type FetchRoute } from '../test/fetchMock.js';
import { InvitationActions, type InvitationActionsProps } from './InvitationActions.js';

/**
 * Invitation accept/decline (plan 07b, D7.6): every action behind an
 * explicit confirm; finalize_url → done view; preview → second confirm
 * step; needs_details verbatim.
 */

interface Scenario {
  /** Structured content for accept_invitation / decline_invitation. */
  accept?: unknown;
  decline?: unknown;
  /** Structured content for confirm_preview. */
  confirm?: unknown;
}

const INVITATION = { id: 'inv-1', jobNumericId: '141', jobTitle: 'React dashboard' };

function makeRoutes(
  scenario: Scenario,
  calls: Array<{ tool: string; args: Record<string, unknown> }>,
) {
  const manage: FetchRoute = async (req) => {
    const body = (await req.json()) as { args: Record<string, unknown> };
    calls.push({ tool: 'upwork__manage_proposals', args: body.args });
    const action = body.args.action as string;
    return jsonResponse({
      isError: false,
      ms: 1,
      content: [],
      structuredContent: action === 'decline_invitation' ? scenario.decline ?? { status: 'ok' } : scenario.accept ?? { status: 'ok' },
    });
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
    '/api/tools/upwork__manage_proposals/call': manage,
    '/api/tools/upwork__confirm_preview/call': confirm,
  } as const;
}

function renderActions(
  scenario: Scenario = {},
  props: Partial<InvitationActionsProps> = {},
) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  vi.stubGlobal('fetch', fetchMock(makeRoutes(scenario, calls)));
  const onDone = vi.fn();
  render(
    <InvitationActions
      invitation={INVITATION}
      orgUid="org-1"
      live={new Set(['upwork__manage_proposals', 'upwork__confirm_preview'])}
      onDone={onDone}
      {...props}
    />,
  );
  return { calls, onDone };
}

const dialogButton = (name: string): HTMLElement =>
  within(screen.getByRole('dialog')).getByRole('button', { name });

describe('InvitationActions (plan 07b)', () => {
  it('accept is binding: confirm, then a done view with the finalize link', async () => {
    const { calls, onDone } = renderActions({
      accept: { status: 'action_required', finalize_url: 'https://www.upwork.com/ab/2/x' },
    });

    fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }));
    await screen.findByText(/accepting is a binding action/i);
    expect(calls).toHaveLength(0); // no call before explicit confirm

    fireEvent.click(dialogButton('Accept'));
    await waitFor(() => {
      expect(calls.some((c) => c.tool === 'upwork__manage_proposals')).toBe(true);
    });
    const acceptCall = calls.find((c) => c.tool === 'upwork__manage_proposals');
    expect(acceptCall?.args).toEqual({ action: 'accept_invitation', job_id: '141', org_uid: 'org-1' });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/finish the acceptance on upwork\.com/i);
    const link = within(dialog).getByRole('link', { name: /finish on upwork\.com/i });
    expect(link).toHaveAttribute('href', 'https://www.upwork.com/ab/2/x');
    // A binding finalize does NOT refresh the list or confirm anything.
    expect(onDone).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.tool === 'upwork__confirm_preview')).toHaveLength(0);
  });

  it('decline runs direct: confirm, success, list refresh, no confirm_preview', async () => {
    const { calls, onDone } = renderActions({ decline: { status: 'ok' } });

    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));
    await screen.findByRole('dialog');
    fireEvent.click(dialogButton('Decline'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual({
      action: 'decline_invitation',
      job_id: '141',
      org_uid: 'org-1',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a preview result chains into the second confirm_preview step', async () => {
    const { calls, onDone } = renderActions({
      decline: { preview_id: 'pv-9', type: 'invitation_decline' },
      confirm: { status: 'confirmed' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));
    await screen.findByRole('dialog');
    fireEvent.click(dialogButton('Decline'));

    // Step 1 returned a preview → the second dialog opens.
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
      type: 'invitation_decline',
      preview_id: 'pv-9',
    });
  });

  it('surfaces needs_details verbatim and does not refresh', async () => {
    const { calls, onDone } = renderActions({
      accept: { needs_details: 'job_id is required for accept_invitation' },
    });

    fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }));
    await screen.findByRole('dialog');
    fireEvent.click(dialogButton('Accept'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('job_id is required for accept_invitation');
    expect(onDone).not.toHaveBeenCalled();
    // The retry button exists but a failed attempt must not have confirmed.
    expect(calls.filter((c) => c.tool === 'upwork__confirm_preview')).toHaveLength(0);
  });

  it('falls back to invitation_id when the row has no numeric job id', async () => {
    const { calls } = renderActions(
      { decline: { status: 'ok' } },
      { invitation: { id: 'inv-7', jobNumericId: null, jobTitle: 'X' } },
    );
    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));
    await screen.findByRole('dialog');
    fireEvent.click(dialogButton('Decline'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.args).toEqual({
      action: 'decline_invitation',
      invitation_id: 'inv-7',
      org_uid: 'org-1',
    });
  });

  it('reports unavailability instead of calling anything when the tool is missing', async () => {
    const { calls, onDone } = renderActions({ decline: { status: 'ok' } }, { live: new Set() });

    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));
    await screen.findByRole('dialog');
    fireEvent.click(dialogButton('Decline'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/not available right now/i);
    expect(calls).toHaveLength(0);
    expect(onDone).not.toHaveBeenCalled();
  });
});
