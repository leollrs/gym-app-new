import { useEffect, useRef, useCallback } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Traps focus within a modal/dialog element.
 *
 * Usage:
 *   const trapRef = useFocusTrap(isOpen, onClose);
 *   <div ref={trapRef} ...>
 *
 * Features:
 *   - Focuses first focusable element on open
 *   - Traps Tab / Shift+Tab within the container
 *   - Closes on Escape key
 *   - Returns focus to the previously focused element on close
 */
export default function useFocusTrap(isOpen, onClose) {
  const containerRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  // Close on Escape
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose?.();
      return;
    }

    if (e.key !== 'Tab') return;

    const container = containerRef.current;
    if (!container) return;

    const focusable = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    // Save the currently focused element to restore later
    previouslyFocusedRef.current = document.activeElement;

    // Focus the first focusable element inside the container
    const timer = setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      const focusable = container.querySelectorAll(FOCUSABLE_SELECTOR);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        // If no focusable children, focus the container itself
        container.setAttribute('tabindex', '-1');
        container.focus();
      }
    }, 50);

    // Attach keydown listener
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);

      // Restore focus to the previously focused element
      if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === 'function') {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [isOpen, handleKeyDown]);

  return containerRef;
}
