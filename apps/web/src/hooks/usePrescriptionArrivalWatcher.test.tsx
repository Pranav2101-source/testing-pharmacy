import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * The wiring test for the app-wide arrival watcher: given a stream of count
 * readings from the shared query, does the pharmacist hear a chime and see a
 * toast at exactly the right moments and no others?
 *
 * The count SOURCE and the reconcile RULES are covered elsewhere
 * (prescriptionNewCount, prescriptionArrivalAlert). Here we mock the query hook
 * so a test can hand the watcher any sequence of readings deterministically,
 * without driving react-query's polling timers.
 */

let mockReading: { data: number | undefined; isSuccess: boolean } = {
  data: undefined,
  isSuccess: false,
};
vi.mock("@/lib/prescriptionNewCount", () => ({
  usePrescriptionNewCount: () => mockReading,
}));

let storedUser: { pharmacyId: string } | null = { pharmacyId: "ph_1" };
vi.mock("@/lib/auth", () => ({
  getStoredUser: () => storedUser,
}));

const chime = vi.fn();
vi.mock("@/lib/notifySound", () => ({
  playArrivalChime: () => chime(),
}));

const toastInfo = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ info: toastInfo, success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));

import { usePrescriptionArrivalWatcher } from "./usePrescriptionArrivalWatcher";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function reading(data: number | undefined, isSuccess = data !== undefined) {
  mockReading = { data, isSuccess };
}

beforeEach(() => {
  sessionStorage.clear();
  storedUser = { pharmacyId: "ph_1" };
  reading(undefined, false);
  chime.mockClear();
  toastInfo.mockClear();
});

describe("usePrescriptionArrivalWatcher", () => {
  it("says nothing on the first count it sees — whatever is waiting is not news", () => {
    reading(3);
    renderHook(() => usePrescriptionArrivalWatcher(), { wrapper });

    expect(toastInfo).not.toHaveBeenCalled();
    expect(chime).not.toHaveBeenCalled();
  });

  it("chimes and toasts once when the count rises, from any screen", () => {
    reading(3);
    const { rerender } = renderHook(() => usePrescriptionArrivalWatcher(), { wrapper });

    reading(5);
    rerender();

    expect(toastInfo).toHaveBeenCalledWith("2 new prescriptions arrived from clinics");
    expect(chime).toHaveBeenCalledTimes(1);
  });

  it("does not repeat the alert while the count holds steady", () => {
    reading(0);
    const { rerender } = renderHook(() => usePrescriptionArrivalWatcher(), { wrapper });

    reading(1);
    rerender();
    reading(1);
    rerender();
    reading(1);
    rerender();

    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledWith("New prescription arrived from a clinic");
    expect(chime).toHaveBeenCalledTimes(1);
  });

  it("re-baselines silently when rows are opened, then alerts again on the next real arrival", () => {
    reading(4);
    const { rerender } = renderHook(() => usePrescriptionArrivalWatcher(), { wrapper });

    reading(1); // pharmacist opened 3
    rerender();
    expect(toastInfo).not.toHaveBeenCalled();

    reading(2); // one genuinely new
    rerender();
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledWith("New prescription arrived from a clinic");
  });

  it("stays silent while the poll is failing (no successful reading yet)", () => {
    reading(3);
    const { rerender } = renderHook(() => usePrescriptionArrivalWatcher(), { wrapper });

    // query errors — isSuccess false, stale data still present
    mockReading = { data: 9, isSuccess: false };
    rerender();

    expect(toastInfo).not.toHaveBeenCalled();
    expect(chime).not.toHaveBeenCalled();
  });

  it("never alerts a user with no pharmacy (platform admin / support agent)", () => {
    storedUser = null;
    reading(2);
    const { rerender } = renderHook(() => usePrescriptionArrivalWatcher(), { wrapper });

    reading(6);
    rerender();

    expect(toastInfo).not.toHaveBeenCalled();
    expect(chime).not.toHaveBeenCalled();
  });

  it("a reload mid-shift does not re-announce prescriptions that were already waiting", () => {
    reading(2);
    const first = renderHook(() => usePrescriptionArrivalWatcher(), { wrapper });
    reading(5);
    first.rerender();
    expect(toastInfo).toHaveBeenCalledTimes(1);
    first.unmount();

    // Simulate a page reload: fresh hook instance, same tab (sessionStorage kept),
    // server still reports 5.
    toastInfo.mockClear();
    chime.mockClear();
    reading(5);
    renderHook(() => usePrescriptionArrivalWatcher(), { wrapper });

    expect(toastInfo).not.toHaveBeenCalled();
    expect(chime).not.toHaveBeenCalled();
  });

  it("refreshes the prescriptions list when it chimes, so open lists update with the sound", () => {
    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    reading(1);
    const { rerender } = renderHook(() => usePrescriptionArrivalWatcher(), { wrapper });

    reading(4);
    rerender();

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["prescriptions"] });
    invalidateSpy.mockRestore();
  });
});
