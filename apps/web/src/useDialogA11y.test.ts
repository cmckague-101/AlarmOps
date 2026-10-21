import { describe, expect, it, vi } from 'vitest';
import { bindDrawerBackdrop } from './useDialogA11y';

function setup(drawer = true) {
  const close = { click: vi.fn() };
  const overlay = {
    classList: { contains: (name: string) => name === 'overlay' },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const dialog = {
    parentElement: overlay,
    classList: { contains: (name: string) => drawer && name === 'drawer' },
    querySelector: vi.fn(() => close),
  };
  const cleanup = bindDrawerBackdrop(dialog as unknown as HTMLElement);
  const click = (target: unknown) => overlay.addEventListener.mock.calls[0]?.[1]({ target });
  return { close, overlay, dialog, cleanup, click };
}

describe('drawer backdrop dismissal', () => {
  it('uses the X button when clicking the backdrop', () => {
    const { close, overlay, dialog, click } = setup();
    click(overlay);
    expect(dialog.querySelector).toHaveBeenCalledWith('header button.close');
    expect(close.click).toHaveBeenCalledOnce();
  });

  it('does not dismiss clicks inside the drawer or a nested overlay', () => {
    const { close, dialog, click } = setup();
    click(dialog);
    click({ className: 'overlay' });
    expect(close.click).not.toHaveBeenCalled();
  });

  it('leaves non-drawer dialogs unchanged', () => {
    const { overlay, cleanup } = setup(false);
    expect(overlay.addEventListener).not.toHaveBeenCalled();
    expect(cleanup).toBeUndefined();
  });

  it('removes the backdrop listener on cleanup', () => {
    const { overlay, cleanup } = setup();
    cleanup?.();
    expect(overlay.removeEventListener).toHaveBeenCalledWith('click', overlay.addEventListener.mock.calls[0][1]);
  });
});
