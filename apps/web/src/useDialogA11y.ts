import { useEffect, useId, useRef } from 'react';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function bindDrawerBackdrop(dialog: HTMLElement) {
  const overlay = dialog.parentElement;
  if (!dialog.classList.contains('drawer') || !overlay?.classList.contains('overlay')) return;

  const handleClick = (event: MouseEvent) => {
    if (event.target !== overlay) return;
    // Use the X button so confirmation prompts and disabled states stay identical.
    dialog.querySelector<HTMLButtonElement>('header button.close')?.click();
  };
  overlay.addEventListener('click', handleClick);
  return () => overlay.removeEventListener('click', handleClick);
}

export function useDialogA11y<T extends HTMLElement = HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog) return;

    const background = Array.from(document.querySelectorAll<HTMLElement>(
      '.app-shell > .sidebar, .app-shell > .app-main, .admin-page > header, .admin-page > main'
    ));
    const newlyInert = background.filter(element => !element.hasAttribute('inert'));
    newlyInert.forEach(element => element.setAttribute('inert', ''));

    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    window.requestAnimationFrame(() => (
      dialog.querySelector<HTMLElement>('[autofocus]') ?? focusable()[0] ?? dialog
    ).focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const unbindBackdrop = bindDrawerBackdrop(dialog);
    dialog.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      unbindBackdrop?.();
      dialog.removeEventListener('keydown', handleKeyDown);
      newlyInert.forEach(element => element.removeAttribute('inert'));
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return { ref, titleId };
}
