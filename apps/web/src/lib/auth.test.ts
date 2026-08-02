import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSession,
  clearUser,
  getAccessToken,
  getStoredUser,
  isPlatformAdmin,
  isSupportStaff,
  storeTokens,
  storeUser,
  type StoredUser,
} from "./auth";

/**
 * Session state. Two properties matter more than the rest:
 *
 *  1. The access token must never be readable from storage — that is the whole
 *     reason it lives in a module variable rather than localStorage.
 *  2. Logging out must leave nothing behind. A pharmacy till is a shared machine;
 *     a residual profile means the next person on shift acts as the last one, and
 *     every audit row is attributed to the wrong staff member.
 */

const USER: StoredUser = {
  id: "u-1",
  name: "Ramesh Kumar",
  email: "ramesh@pharmacy.test",
  role: "PHARMACIST",
  pharmacyId: "ph-1",
  pharmacyName: "Checkup Care Pharmacy",
};

beforeEach(() => {
  clearSession();
  localStorage.clear();
});

describe("stored user", () => {
  it("round-trips a profile through localStorage", () => {
    storeUser(USER);
    expect(getStoredUser()).toEqual(USER);
  });

  it("returns null when nothing is stored", () => {
    expect(getStoredUser()).toBeNull();
  });

  it("returns null rather than throwing on corrupt JSON", () => {
    // A half-written localStorage value must not white-screen the whole app.
    localStorage.setItem("checkup_user", "{not json");
    expect(getStoredUser()).toBeNull();
  });

  it("notifies listeners on login so the header updates without a reload", () => {
    const listener = vi.fn();
    window.addEventListener("auth:change", listener);
    storeUser(USER);
    expect(listener).toHaveBeenCalled();
    window.removeEventListener("auth:change", listener);
  });

  it("notifies listeners on logout", () => {
    storeUser(USER);
    const listener = vi.fn();
    window.addEventListener("auth:change", listener);
    clearUser();
    expect(listener).toHaveBeenCalled();
    window.removeEventListener("auth:change", listener);
  });
});

describe("access token", () => {
  it("is retrievable in-memory after being stored", () => {
    storeTokens("jwt-abc");
    expect(getAccessToken()).toBe("jwt-abc");
  });

  it("is NOT written to localStorage or sessionStorage", () => {
    // The security property this design exists for: an XSS payload cannot read the
    // token out of storage, nor use it after the tab closes.
    storeTokens("jwt-secret-value");

    expect(JSON.stringify(localStorage)).not.toContain("jwt-secret-value");
    expect(JSON.stringify(sessionStorage)).not.toContain("jwt-secret-value");
    expect(localStorage.getItem("accessToken")).toBeNull();
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("is null before login", () => {
    expect(getAccessToken()).toBeNull();
  });

  it("is overwritten by a refresh, not appended to", () => {
    storeTokens("old-token");
    storeTokens("new-token");
    expect(getAccessToken()).toBe("new-token");
  });
});

describe("clearSession — the shared-till case", () => {
  it("drops the in-memory token", () => {
    storeTokens("jwt-abc");
    clearSession();
    expect(getAccessToken()).toBeNull();
  });

  it("drops the cached profile", () => {
    storeUser(USER);
    clearSession();
    expect(getStoredUser()).toBeNull();
    expect(localStorage.getItem("checkup_user")).toBeNull();
  });

  it("leaves no trace of the previous user's name or pharmacy anywhere in storage", () => {
    storeUser(USER);
    storeTokens("jwt-abc");
    clearSession();

    const everything = JSON.stringify(localStorage) + JSON.stringify(sessionStorage);
    expect(everything).not.toContain("Ramesh Kumar");
    expect(everything).not.toContain("ph-1");
    expect(everything).not.toContain("jwt-abc");
  });

  it("expires the legacy auth-token cookie left by older builds", () => {
    document.cookie = "auth-token=stale-value; path=/";
    clearSession();
    expect(document.cookie).not.toContain("stale-value");
  });

  it("is safe to call when already logged out", () => {
    expect(() => clearSession()).not.toThrow();
    expect(getAccessToken()).toBeNull();
  });
});

describe("role checks", () => {
  it("treats SUPPORT_AGENT and PLATFORM_ADMIN as support staff", () => {
    storeUser({ ...USER, role: "SUPPORT_AGENT" });
    expect(isSupportStaff()).toBe(true);

    storeUser({ ...USER, role: "PLATFORM_ADMIN" });
    expect(isSupportStaff()).toBe(true);
  });

  it("does not treat pharmacy staff as support staff", () => {
    // A false positive here would expose platform-wide support tooling to an
    // ordinary pharmacy user.
    for (const role of ["OWNER", "MANAGER", "PHARMACIST", "CASHIER"]) {
      storeUser({ ...USER, role });
      expect(isSupportStaff()).toBe(false);
      expect(isPlatformAdmin()).toBe(false);
    }
  });

  it("identifies only PLATFORM_ADMIN as platform admin", () => {
    storeUser({ ...USER, role: "PLATFORM_ADMIN" });
    expect(isPlatformAdmin()).toBe(true);

    storeUser({ ...USER, role: "SUPPORT_AGENT" });
    expect(isPlatformAdmin()).toBe(false);
  });

  it("denies both when logged out — absence of a role is not elevation", () => {
    expect(isSupportStaff()).toBe(false);
    expect(isPlatformAdmin()).toBe(false);
  });

  it("denies both when the stored profile is corrupt", () => {
    localStorage.setItem("checkup_user", "{not json");
    expect(isSupportStaff()).toBe(false);
    expect(isPlatformAdmin()).toBe(false);
  });

  it("is not fooled by a lowercase role string", () => {
    // Role comparison is exact; a case-mangled value must fail closed.
    storeUser({ ...USER, role: "platform_admin" });
    expect(isPlatformAdmin()).toBe(false);
  });
});
