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

const KEY = "checkup_user";

export function storeUser(user: StoredUser): void {
  localStorage.setItem(KEY, JSON.stringify(user));
}

export function clearUser(): void {
  localStorage.removeItem(KEY);
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

function formatRole(raw: string): string {
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

export function useCurrentUser() {
  const u            = getStored();
  const name         = u?.name         ?? "User";
  const rawRole      = u?.role         ?? "STAFF";
  const pharmacyName = u?.pharmacyName ?? "Pharmacy";

  return {
    name,
    role:             formatRole(rawRole),
    pharmacyName,
    initials:         toInitials(name),
    pharmacyInitials: toInitials(pharmacyName),
  };
}
