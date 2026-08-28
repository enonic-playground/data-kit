// ? Only loaded in jsdom tests (per-file annotation), but setup runs for all environments.
// Guards ensure these mocks are no-ops in node environment.

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

declare global {
  interface Window {
    /** Live ResizeObserver callbacks, so a test can report a layout change jsdom will never make. */
    __resizeObserverCallbacks?: Set<ResizeObserverCallback>;
  }
}

afterEach(cleanup);

if (typeof window !== 'undefined') {
  // ThemeProvider calls window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });

  // Radix UI portals and dialogs need ResizeObserver. jsdom never resizes anything, so the
  // callbacks are kept on `window` for a test that needs to say the layout moved — see the
  // log viewer, which re-aims its jump to the end of the file on exactly that signal.
  const callbacks = new Set<ResizeObserverCallback>();
  window.__resizeObserverCallbacks = callbacks;
  window.ResizeObserver = class ResizeObserver {
    #callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.#callback = callback;
    }
    observe() {
      callbacks.add(this.#callback);
    }
    unobserve() {}
    disconnect() {
      callbacks.delete(this.#callback);
    }
  };

  // jsdom 28 uses Node.js built-in localStorage which lacks standard methods
  if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      writable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, String(value)),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
        get length() {
          return store.size;
        },
        key: (index: number) => [...store.keys()][index] ?? null,
      },
    });
  }
}
