// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createToastQueue } from '../../app/src/ui/toast';

describe('createToastQueue', () => {
  it('shows at most maxVisible, promotes FIFO, and uses alert for danger', () => {
    vi.useFakeTimers();
    const q = createToastQueue({ maxVisible: 1, defaultDuration: 0 });
    const first = q.push({ message: 'Kopirano.', variant: 'success', dismissLabel: 'Ukloni' });
    q.push({ message: 'Greška.', variant: 'danger', dismissLabel: 'Ukloni' });
    expect(q.container.querySelectorAll('.toast').length).toBe(1);
    expect(q.container.querySelector('.toast')?.getAttribute('role')).toBe('status');
    first.dismiss();
    expect(q.container.querySelector('.toast')?.getAttribute('role')).toBe('alert');
    expect(q.size).toBe(1);
    q.clear();
    expect(q.size).toBe(0);
    vi.useRealTimers();
  });
  it('auto-dismisses after duration', () => {
    vi.useFakeTimers();
    const q = createToastQueue({ defaultDuration: 1000 });
    q.push({ message: 'x', dismissLabel: 'y' });
    vi.advanceTimersByTime(1001);
    expect(q.size).toBe(0);
    vi.useRealTimers();
  });
});
