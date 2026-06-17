import { useState, useEffect } from "react";

export type StoredUser = {
  id:           string;
  name:         string;
  email:        string;
  role:         string;
  pharmacyId:   string;
  pharmacyName: string;
};

export function getStoredUser(): StoredUser | null {
  try {
    const raw = localStorage.getItem("checkup_user");
    return raw ? (JSON.parse(raw) as StoredUser) : null;
  } catch {
    return null;
  }
}

export function isSupportStaff(): boolean {
  const role = getStoredUser()?.role ?? "";
  return role === "SUPPORT_AGENT" || role === "PLATFORM_ADMIN";
}

export function isPlatformAdmin(): boolean {
  return getStoredUser()?.role === "PLATFORM_ADMIN";
}

const USER_KEY = "checkup_user";

export function storeUser(user: StoredUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event("auth:change"));
}

export function clearUser(): void {
  localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event("auth:change"));
}

// ── Access-token storage (in-memory only) ─────────────────────────────────────
// The access token is kept in a module-level variable — never in localStorage
// or sessionStorage. An XSS script running in the same page can still call
// getAccessToken() during the current session, but it cannot read the value
// out of storage, send it elsewhere, or use it after the page is closed.
// The refresh token is in an httpOnly cookie: completely invisible to JS.
// On page reload the access token is gone; the first 401 silently re-issues
// it via the httpOnly refresh-token cookie (see api-client.ts).

let _accessToken: string | null = null;

export function storeTokens(accessToken: string): void {
  _accessToken = accessToken;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

/** Clears every trace of the session: in-memory token, cached profile, legacy cookie. */
export function clearSession(): void {
  _accessToken = null;
  clearUser();
  // Expire the auth-token cookie that older builds set. No longer written
  // anywhere — this just cleans up any lingering cookies in existing browsers.
  document.cookie = "auth-token=; path=/; max-age=0; SameSite=Lax";
}

function getStored(): StoredUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as StoredUser) : null;
  } catch {
    return null;
  }
}

function toInitials(str: string): string {
  return str.split(" ").map(w => w[0] ?? "").join("").slice(0, 2).toUpperCase() || "??";
}

const ROLE_DISPLAY: Record<string, string> = {
  OWNER:          "Owner",
  MANAGER:        "Manager",
  PHARMACIST:     "Pharmacist",
  CASHIER:        "Cashier",
  SUPPORT_AGENT:  "Support Agent",
  PLATFORM_ADMIN: "Platform Admin",
};

function formatRole(raw: string): string {
  return ROLE_DISPLAY[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

export function useCurrentUser() {
  const [user, setUser] = useState<StoredUser | null>(getStored);

  useEffect(() => {
    function sync() { setUser(getStored()); }
    window.addEventListener("auth:change", sync);
    window.addEventListener("storage",    sync);
    return () => {
      window.removeEventListener("auth:change", sync);
      window.removeEventListener("storage",    sync);
    };
  }, []);

  const name         = user?.name         ?? "User";
  const rawRole      = user?.role         ?? "STAFF";
  const pharmacyName = user?.pharmacyName ?? "Pharmacy";

  return {
    name,
    role:             formatRole(rawRole),
    rawRole,
    pharmacyName,
    initials:         toInitials(name),
    pharmacyInitials: toInitials(pharmacyName),
  };
}
