import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

/**
 * Global test setup.
 *
 * Everything here exists to stop state leaking between test files. This app keeps
 * real state outside React — the access token is a module-level variable, the user
 * profile and billing drafts are in localStorage, and the billing cart is a zustand
 * store — so a test that logs in or saves a draft changes what the NEXT test sees.
 * That class of failure shows up as a test that passes alone and fails in a suite,
 * which is the most expensive kind to debug.
 */

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});

beforeEach(() => {
  localStorage.clear();
});

/**
 * jsdom implements neither of these, and both are reached by code under test:
 * `matchMedia` by any responsive hook, `ResizeObserver` by Recharts'
 * ResponsiveContainer (every chart on the dashboard and reports pages).
 * Without the stubs those render paths throw before an assertion runs.
 */
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

/**
 * jsdom ships `Blob` WITHOUT `Blob.prototype.text()`, which every real browser has.
 *
 * That matters because `getDownloadErrorMessage` recovers a failed export's reason
 * by reading the Blob back to text — the code path would silently take its `catch`
 * branch in tests and appear broken while working fine in production. Polyfilling
 * makes jsdom match the browser rather than papering over an app bug.
 */
if (typeof Blob !== "undefined" && !Blob.prototype.text) {
  Blob.prototype.text = function text(this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

// crypto.randomUUID is used by draftStorage.saveDraft; older jsdom builds ship
// `crypto` without it, which would fail the draft tests for an unrelated reason.
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: () => `test-${Math.random().toString(16).slice(2)}-${Date.now()}`,
    configurable: true,
  });
}
