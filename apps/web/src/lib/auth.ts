// Persists the logged-in user's profile to localStorage so any component
// can read it synchronously without an extra API call.

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

const KEY         = "checkup_user";
const TOKEN_KEY   = "token";
const REFRESH_KEY = "refresh_token";

export function storeUser(user: StoredUser): void {
  localStorage.setItem(KEY, JSON.stringify(user));
}

export function clearUser(): void {
  localStorage.removeItem(KEY);
}

// ── Token storage ─────────────────────────────────────────────────────────────
// Access token expires in 15 minutes (JWT_EXPIRES_IN); the refresh token lets
// api-client transparently obtain a new one so users are never logged out
// mid-shift. Both live in localStorage so all tabs share a single session.

export function storeTokens(accessToken: string, refreshToken?: string): void {
  localStorage.setItem(TOKEN_KEY, accessToken);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

/** Clears every trace of the session: tokens, cached profile, legacy cookie. */
export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  clearUser();
  // Expire the auth-token cookie that older builds set. It is no longer
  // written anywhere; this just cleans up existing users' browsers.
  document.cookie = "auth-token=; path=/; max-age=0; SameSite=Lax";
}

function getStored(): StoredUser | null {
  try {
    const raw = localStorage.getItem(KEY);
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
  const u            = getStored();
  const name         = u?.name         ?? "User";
  const rawRole      = u?.role         ?? "STAFF";
  const pharmacyName = u?.pharmacyName ?? "Pharmacy";

  return {
    name,
    role:             formatRole(rawRole),
    rawRole,
    pharmacyName,
    initials:         toInitials(name),
    pharmacyInitials: toInitials(pharmacyName),
  };
}
