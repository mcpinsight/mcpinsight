import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

/**
 * JSDOM doesn't implement scrollIntoView (used by Radix Select on mount) or
 * the PointerEvent constructor that @radix-ui sniffs. Stub both so component
 * tests that open a Select don't throw. Keep the stubs here, not in the
 * component, so the prod bundle stays clean.
 */
if (typeof window !== 'undefined') {
  const elProto = Element.prototype as unknown as {
    scrollIntoView?: () => void;
    hasPointerCapture?: () => boolean;
    releasePointerCapture?: () => void;
  };
  if (typeof elProto.scrollIntoView !== 'function') {
    elProto.scrollIntoView = () => {};
  }
  if (typeof elProto.hasPointerCapture !== 'function') {
    elProto.hasPointerCapture = () => false;
  }
  if (typeof elProto.releasePointerCapture !== 'function') {
    elProto.releasePointerCapture = () => {};
  }
  const win = window as unknown as { PointerEvent?: typeof MouseEvent };
  if (typeof win.PointerEvent !== 'function') {
    win.PointerEvent = window.MouseEvent;
  }
}
