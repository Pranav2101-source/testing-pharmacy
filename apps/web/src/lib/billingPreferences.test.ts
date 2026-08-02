import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { api } from "./api-client";
import { useBillingPreferences } from "./billingPreferences";

/**
 * Billing preferences moved from browser localStorage to the database.
 *
 * The contract these tests exist to hold: **the database is the source of truth,
 * localStorage is only a cache.** Everything below is a consequence of that
 * ordering, and each one is a way the old localStorage-only version silently
 * diverged between tills.
 */

const STORAGE_KEY = "checkup_billing_prefs_v1";

/** A deliberately non-default config, so "came from the server" is unmistakable. */
const SERVER_PREFS = {
  version: 1,
  actions: [
    { id: "save_print", enabled: true,  pinned: true,  order: 0 },
    { id: "delivery",   enabled: true,  pinned: true,  order: 1 },
    { id: "save_new",   enabled: false, pinned: false, order: 2 },
  ],
};

const CACHED_PREFS = {
  version: 1,
  actions: [
    { id: "save_print", enabled: true, pinned: true, order: 0 },
    { id: "return",     enabled: true, pinned: true, order: 1 },
  ],
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function mockGet(data: unknown) {
  return vi.spyOn(api, "get").mockResolvedValue({ data: { data } } as never);
}

describe("the database wins", () => {
  it("replaces the cached copy with whatever the server returns", async () => {
    // The core property. Two tills that disagree must converge on the server's copy.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(CACHED_PREFS));
    mockGet(SERVER_PREFS);

    const { result } = renderHook(() => useBillingPreferences());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ids = result.current.sortedActions.map((a) => a.id);
    expect(ids.slice(0, 3)).toEqual(["save_print", "delivery", "save_new"]);
    expect(result.current.pinnedActions.map((a) => a.id)).toContain("delivery");
  });

  it("refreshes the cache from the server copy", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(CACHED_PREFS));
    mockGet(SERVER_PREFS);

    const { result } = renderHook(() => useBillingPreferences());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const cached = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(cached.actions.map((a: { id: string }) => a.id)).toContain("delivery");
  });

  it("applies built-in defaults when the pharmacy has never configured anything", async () => {
    mockGet(null);

    const { result } = renderHook(() => useBillingPreferences());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.pinnedActions.map((a) => a.id))
      .toEqual(["save_print", "save_new", "save_draft"]);
  });

  it("does NOT write defaults back on first load", async () => {
    // "Never configured" must stay distinguishable from "deliberately set", or a
    // first page view would silently claim the pharmacy chose these.
    mockGet(null);
    const put = vi.spyOn(api, "put");

    const { result } = renderHook(() => useBillingPreferences());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(put).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("the cache is only an accelerator", () => {
  it("paints from cache before the server responds", async () => {
    // A till reopened mid-shift should not visibly rearrange its buttons.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(CACHED_PREFS));
    vi.spyOn(api, "get").mockReturnValue(new Promise(() => {}) as never); // never resolves

    const { result } = renderHook(() => useBillingPreferences());

    expect(result.current.loading).toBe(true);
    expect(result.current.pinnedActions.map((a) => a.id)).toContain("return");
  });

  it("keeps showing the cached copy when the server is unreachable", async () => {
    // Losing the action bar mid-shift is worse than showing a slightly stale one.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(CACHED_PREFS));
    vi.spyOn(api, "get").mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useBillingPreferences());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.pinnedActions.map((a) => a.id)).toContain("return");
    expect(result.current.error).toBeTruthy();
  });

  it("survives a corrupt cache", async () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    mockGet(SERVER_PREFS);

    const { result } = renderHook(() => useBillingPreferences());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sortedActions.length).toBeGreaterThan(0);
  });
});

describe("writes", () => {
  it("persists a change to the database", async () => {
    mockGet(SERVER_PREFS);
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: { data: {} } } as never);

    const { result } = renderHook(() => useBillingPreferences());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleEnabled("save_print"));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/billing/preferences", expect.anything()));
  });

  it("caches only AFTER the server accepts the write", async () => {
    // A rejected change must not survive a reload by hiding in the cache.
    mockGet(SERVER_PREFS);
    vi.spyOn(api, "put").mockRejectedValue(new Error("403"));

    const { result } = renderHook(() => useBillingPreferences());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const cacheBefore = localStorage.getItem(STORAGE_KEY);

    act(() => result.current.toggleEnabled("save_print"));
    await waitFor(() => expect(result.current.error).toBeTruthy());

    expect(localStorage.getItem(STORAGE_KEY)).toBe(cacheBefore);
  });

  it("surfaces a save failure rather than showing a false success", async () => {
    mockGet(SERVER_PREFS);
    vi.spyOn(api, "put").mockRejectedValue(new Error("nope"));

    const { result } = renderHook(() => useBillingPreferences());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.togglePinned("delivery"));
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  /**
   * The data-loss guard. If the load failed, state is whatever the cache held —
   * possibly stale. Writing that back would revert changes another till saved.
   */
  it("refuses to write while the server copy has not loaded", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(CACHED_PREFS));
    vi.spyOn(api, "get").mockRejectedValue(new Error("offline"));
    const put = vi.spyOn(api, "put");

    const { result } = renderHook(() => useBillingPreferences());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleEnabled("save_print"));

    expect(put).not.toHaveBeenCalled();
    expect(result.current.error).toBeTruthy();
  });

  it("resetToDefaults goes through the database too", async () => {
    mockGet(SERVER_PREFS);
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: { data: {} } } as never);

    const { result } = renderHook(() => useBillingPreferences());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.resetToDefaults());
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(result.current.pinnedActions.map((a) => a.id))
      .toEqual(["save_print", "save_new", "save_draft"]);
  });
});

describe("schema drift in stored configs", () => {
  it("adds actions this build knows about but the stored config predates", async () => {
    // Otherwise a new action would be invisible on every till that had ever saved.
    mockGet({ version: 1, actions: [{ id: "save_print", enabled: true, pinned: true, order: 0 }] });

    const { result } = renderHook(() => useBillingPreferences());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ids = result.current.sortedActions.map((a) => a.id);
    expect(ids).toContain("return");
    expect(ids).toContain("delivery");
  });

  it("drops action ids this build no longer recognises", async () => {
    mockGet({
      version: 1,
      actions: [
        { id: "save_print",     enabled: true, pinned: true, order: 0 },
        { id: "removed_action", enabled: true, pinned: true, order: 1 },
      ],
    });

    const { result } = renderHook(() => useBillingPreferences());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sortedActions.map((a) => a.id)).not.toContain("removed_action");
  });

  it("falls back to defaults for a config of an unknown version", async () => {
    mockGet({ version: 99, actions: [] });

    const { result } = renderHook(() => useBillingPreferences());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.pinnedActions.map((a) => a.id))
      .toEqual(["save_print", "save_new", "save_draft"]);
  });

  it("falls back to defaults when actions is not an array", async () => {
    mockGet({ version: 1, actions: "nonsense" });

    const { result } = renderHook(() => useBillingPreferences());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sortedActions.length).toBeGreaterThan(0);
  });
});
