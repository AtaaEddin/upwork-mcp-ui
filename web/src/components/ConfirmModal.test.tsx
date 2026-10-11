import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmModal, type ConfirmOutcome } from './ConfirmModal.js';

const closeDialog = (): void => {
  const el = screen.getByRole('dialog');
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
};

describe('ConfirmModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ConfirmModal
        open={false}
        title="Submit proposal"
        summary="summary text"
        onConfirm={vi.fn(async (): Promise<ConfirmOutcome> => ({ status: 'proceed' }))}
        onClose={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the summary and runs onConfirm only after explicit confirm', async () => {
    const onConfirm = vi.fn(async (): Promise<ConfirmOutcome> => ({ status: 'proceed' }));
    const onClose = vi.fn();
    render(
      <ConfirmModal
        open
        title="Submit proposal"
        summary={<span>exactly what happens</span>}
        confirmLabel="Submit proposal"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Submit proposal');
    expect(screen.getByText('exactly what happens')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Submit proposal' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // proceed ⇒ the dialog closes (page takes over).
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('shows a done view with a finalize link, no auto-completion', async () => {
    const onConfirm = vi.fn(
      async (): Promise<ConfirmOutcome> => ({
        status: 'done',
        message: 'Binding step — finish on upwork.com',
        finalizeUrl: 'https://www.upwork.com/finalize/1',
      }),
    );
    render(
      <ConfirmModal
        open
        title="Accept invitation"
        summary={<span>accepting is binding</span>}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByText('Binding step — finish on upwork.com');
    expect(screen.getByRole('link', { name: /finish on upwork\.com/i })).toHaveAttribute(
      'href',
      'https://www.upwork.com/finalize/1',
    );
  });

  it('shows the error with Close/Retry; retry re-runs onConfirm', async () => {
    const onConfirm = vi
      .fn(async (): Promise<ConfirmOutcome> => ({ status: 'proceed' }))
      .mockRejectedValueOnce(new Error('Upwork rejected the call.'))
      .mockResolvedValueOnce({ status: 'proceed' });
    render(
      <ConfirmModal
        open
        title="Submit proposal"
        summary={<span>x</span>}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Upwork rejected the call.');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
  });

  it('ESC closes from the confirm phase, not while running', async () => {
    let resolve!: (o: ConfirmOutcome) => void;
    const pending = new Promise<ConfirmOutcome>((r) => (resolve = r));
    const onClose = vi.fn();
    render(
      <ConfirmModal
        open
        title="Submit proposal"
        summary={<span>x</span>}
        onConfirm={async () => pending}
        onClose={onClose}
      />,
    );
    // ESC before confirm: closes.
    closeDialog();
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByText('Working… this should only take a moment.');
    closeDialog();
    expect(onClose).not.toHaveBeenCalled();
    resolve({ status: 'proceed' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
