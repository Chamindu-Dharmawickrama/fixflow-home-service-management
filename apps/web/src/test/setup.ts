// The type declarations (and the matchers, as a side effect of the import).
import "@testing-library/jest-dom/vitest";

import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, expect, vi } from "vitest";

// F-101 (T25): in some full runs whole files lost every jest-dom matcher ("Invalid Chai property:
// toBeVisible") while other files of the same run had them. The import above registers the matchers
// only when the package is first evaluated in a worker; this setup file runs before every test file,
// so registering here as well cannot be skipped by a cached module.
expect.extend(jestDomMatchers);

afterEach(() => {
  cleanup();
});

// jsdom lacks a few browser APIs that Radix UI primitives rely on.
class ResizeObserverStub {
  observe() {
    /* no layout in jsdom */
  }
  unobserve() {
    /* no layout in jsdom */
  }
  disconnect() {
    /* no layout in jsdom */
  }
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

function polyfillElementMethod(name: string) {
  if (!(name in Element.prototype)) {
    Object.defineProperty(Element.prototype, name, {
      value: () => undefined,
      configurable: true,
      writable: true,
    });
  }
}
for (const name of [
  "scrollIntoView",
  "hasPointerCapture",
  "setPointerCapture",
  "releasePointerCapture",
]) {
  polyfillElementMethod(name);
}
