import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { clearSession, getAccessToken, getRefreshToken, storeTokens } from "./auth";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Token refresh ─────────────────────────────────────────────────────────────
// Access tokens expire after 15 minutes. On a 401 we transparently exchange the
// refresh token for a new pair and retry the original request once, so users
// stay signed in across a full shift without ever seeing the login screen.

// Auth endpoints where a 401 is a real answer (wrong password, revoked token),
// not an expired session — never trigger a refresh or a redirect for these.
const NO_REFRESH_URLS = [
  "/auth/login",
  "/auth/register",
  "/auth/refresh",
  "/auth/forgot-password",
  "/auth/reset-password",
];

// Single-flight: when several requests 401 at the same moment (e.g. a dashboard
// firing parallel queries as the token expires), only ONE refresh call goes out;
// the rest await the same promise. Critical because the backend rotates the
// refresh token on every use — a second concurrent refresh with the old token
// would be rejected and log the user out.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    // Bare axios — going through `api` would re-enter the 401 interceptor.
    const res = await axios.post<{ success: boolean; data: { accessToken: string; refreshToken: string } }>(
      `${BASE_URL}/auth/refresh`,
      { refreshToken },
      { headers: { "Content-Type": "application/json" } },
    );
    const tokens = res.data.data;
    storeTokens(tokens.accessToken, tokens.refreshToken);
    return tokens.accessToken;
  } catch {
    // Refresh token expired or revoked — the session is genuinely over.
    return null;
  }
}

function redirectToLogin(): void {
  clearSession();
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError<{ error?: string; message?: string }>) => {
    const original = err.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const status   = err.response?.status;
    const isAuthEndpoint = NO_REFRESH_URLS.some((u) => original?.url?.includes(u));

    // ── 401: try a silent refresh, then retry the original request once ────
    if (status === 401 && original && !original._retried && !isAuthEndpoint) {
      original._retried = true;

      refreshPromise ??= refreshAccessToken().finally(() => { refreshPromise = null; });
      const newToken = await refreshPromise;

      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }

      redirectToLogin();
      return Promise.reject(err);
    }

    // 401 that can't be recovered (retry also failed, or no refresh possible).
    // Auth endpoints are exempt: a wrong password must show an error, not redirect.
    if (status === 401 && !isAuthEndpoint) {
      redirectToLogin();
      return Promise.reject(err);
    }

    // ── No response: network offline / server unreachable ──────────────────
    if (!err.response) {
      err.message = "Network error — check your internet connection and try again.";
      return Promise.reject(err);
    }

    // ── 429: global rate limit hit ─────────────────────────────────────────
    if (status === 429) {
      err.message = "Too many requests — please wait a moment and try again.";
      return Promise.reject(err);
    }

    // ── 503: server / DB temporarily unavailable ───────────────────────────
    if (status === 503) {
      err.message = "Service temporarily unavailable — please try again shortly.";
      return Promise.reject(err);
    }

    // ── All other errors: normalise message from backend response ──────────
    // The backend always returns { success: false, error: "..." }.
    // Promote the server's error string onto err.message so every catch block
    // can simply read (err as Error).message without digging into err.response.
    const serverMsg: string | undefined =
      err.response.data?.error ?? err.response.data?.message;
    if (serverMsg) err.message = serverMsg;

    return Promise.reject(err);
  },
);
