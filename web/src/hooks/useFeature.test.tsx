import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fetchMock, jsonResponse, type FetchRoute } from '../test/fetchMock.js';
import { FEATURES, type FeatureSpec } from '../lib/registry.js';
import { useFeature } from './useFeature.js';

function Probe({
  spec,
  tool,
  orgUid,
  args,
  toolsLoading,
}: {
  spec: FeatureSpec;
  tool: string | null;
  orgUid: string | null;
  args: Record<string, unknown> | null;
  toolsLoading?: boolean;
}) {
  const { state, reload } = useFeature(spec, tool, orgUid, args, { toolsLoading });
  return (
    <div>
      <span data-testid="state">{state.kind}</span>
      {state.kind === 'error' && <span data-testid="msg">{state.message}</span>}
      {state.kind === 'ok' && <span data-testid="data">{JSON.stringify(state.data)}</span>}
      <button type="button" onClick={reload}>
        retry
      </button>
    </div>
  );
}

function stateOf(): string {
  return screen.getByTestId('state').textContent ?? '';
}

function outcome(body: Record<string, unknown>): Response {
  return jsonResponse({ isError: false, ms: 1, content: [], structuredContent: body });
}

describe('useFeature (plan 06)', () => {
  it('stays idle without an account and unavailable without the tool', () => {
    render(<Probe spec={FEATURES.jobGet} tool="upwork__find_jobs" orgUid={null} args={null} />);
    expect(stateOf()).toBe('idle');

    render(
      <Probe spec={FEATURES.jobGet} tool={null} orgUid="org-1" args={{ id: 'x' }} />,
    );
    expect(screen.getAllByTestId('state').pop()?.textContent).toBe('unavailable');
  });

  it('shows pending instead of unavailable while the tools list loads', () => {
    render(<Probe spec={FEATURES.jobGet} tool={null} orgUid="org-1" args={{ id: 'x' }} toolsLoading />);
    expect(stateOf()).toBe('pending');
  });

  it('calls the tool API with action+org_uid and lands in ok with parsed data', async () => {
    let captured: Record<string, unknown> | null = null;
    const routes: Record<string, FetchRoute> = {
      '/api/tools/upwork__find_jobs/call': async (req) => {
        captured = JSON.parse(await req.text()) as Record<string, unknown>;
        return outcome({ hello: 'world' });
      },
    };
    vi.stubGlobal('fetch', fetchMock(routes));

    render(<Probe spec={FEATURES.jobGet} tool="upwork__find_jobs" orgUid="org-9" args={{ id: '~02z' }} />);

    expect(await screen.findByTestId('data')).toHaveTextContent('{"hello":"world"}');
    expect(captured).toEqual({
      args: { action: 'get', org_uid: 'org-9', id: '~02z' },
    });
  });

  it('maps tool isError results to an error state with the tool text', async () => {
    const routes: Record<string, FetchRoute> = {
      '/api/tools/upwork__find_jobs/call': () =>
        jsonResponse({
          isError: true,
          ms: 1,
          content: [{ type: 'text', text: 'Action not allowed' }],
        }),
    };
    vi.stubGlobal('fetch', fetchMock(routes));

    render(<Probe spec={FEATURES.jobGet} tool="upwork__find_jobs" orgUid="org-1" args={{}} />);

    await vi.waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('error'));
    expect(screen.getByTestId('msg')).toHaveTextContent('Action not allowed');
  });

  it('maps API errors and recovers on retry', async () => {
    let fails = 1;
    const routes: Record<string, FetchRoute> = {
      '/api/tools/upwork__find_jobs/call': () => {
        if (fails > 0) {
          fails -= 1;
          return jsonResponse(
            { error: { code: 'rate_limited', message: 'Slow down, please' } },
            429,
            { 'retry-after': '2' },
          );
        }
        return outcome({ recovered: true });
      },
    };
    vi.stubGlobal('fetch', fetchMock(routes));

    render(<Probe spec={FEATURES.jobGet} tool="upwork__find_jobs" orgUid="org-1" args={{}} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId('msg')).toHaveTextContent(/rate limit reached/i),
    );
    const retry = screen.getByRole('button', { name: 'retry' });
    retry.click();
    expect(await screen.findByTestId('data')).toHaveTextContent('{"recovered":true}');
  });
});
