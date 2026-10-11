import { fireEvent, render, screen } from '@testing-library/react';
import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { toast, toastError, toastSuccess } from '../lib/toast.js';
import { ToastHost } from './Toast.js';

describe('ToastHost', () => {
  it('renders emitted toasts and dismisses them manually', () => {
    render(<ToastHost />);
    act(() => {
      toastSuccess('Proposal submitted.');
    });
    expect(screen.getByText('Proposal submitted.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /dismiss notification/i }));
    expect(screen.queryByText('Proposal submitted.')).toBeNull();
  });

  it('marks error toasts as alerts', () => {
    render(<ToastHost />);
    act(() => {
      toastError('Upwork access denied.');
    });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Upwork access denied.');
  });

  it('keeps only the newest three toasts', () => {
    render(<ToastHost />);
    act(() => {
      toast('info', 'one');
      toast('info', 'two');
      toast('info', 'three');
      toast('info', 'four');
    });
    expect(screen.queryByText('one')).toBeNull();
    expect(screen.getByText('two')).toBeInTheDocument();
    expect(screen.getByText('four')).toBeInTheDocument();
  });
});
