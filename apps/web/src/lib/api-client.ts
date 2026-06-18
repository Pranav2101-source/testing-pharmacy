import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { clearSession, getAccessToken, storeTokens } from "./auth";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api/v1";

export const api = axios.create({
  baseURL:         BASE_URL,
  headers:         { "Content-Type": "application/json" },
  // Required for the browser to send the httpOnly refresh-token cookie on
  // cross-origin requests (Vite dev → Fly.io, Amplify → ALB, etc.).
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // For FormData (file uploads), let the browser set Content-Type so it can
  // include the multipart boundary. The instance default of application/json
  // would cause a 406 from the server.
  if (config.data instanceof FormData) {
    delete config.headers["Content-Type"];
  }
  return config;
});

// ── Token refresh ─────────────────────────────────────────────────────────────
// Access tokens expire after JWT_EXPIRES_IN (default 15 m). On a 401 we call
// /auth/refresh — the browser sends the httpOnly refresh-token cookie
// automatically; no body is needed. On success we store the new access token
// in memory and retry the original request once.
//
// On page reload the in-memory access token is gone. The first 401 from any
// request triggers this silent refresh, so users never see the login screen
// mid-shift as long as their refresh-token cookie (7-day TTL) is still valid.

/** Call once at app boot (from PrivateRoute) to pre-populate the in-memory
 *  access token from the httpOnly refresh-token cookie. Prevents the wave of
 *  401 → retry → success noise that happens when the dashboard mounts before
 *  any token is in memory. Returns true if a valid session exists. */
export async function initAuth(): Promise<boolean> {
  if (getAccessToken()) return true;
  try {
    const res = await axios.post<{ success: boolean; data: { accessToken: string } }>(
      `${BASE_URL}/auth/refresh`,
      {},
      { headers: { "Content-Type": "application/json" }, withCredentials: true },
    );
    storeTokens(res.data.data.accessToken);
    return true;
  } catch {
    return false;
  }
}

const NO_REFRESH_URLS = [
  "/auth/login",
  "/auth/register",
  "/auth/refresh",
  "/auth/forgot-password",
  "/auth/reset-password",
];

// Single-flight: when several requests 401 at the same moment (e.g. a dashboard
// firing parallel queries after a page reload with no in-memory token), only ONE
// refresh call goes out; the rest await the same promise. Critical because the
// backend rotates the refresh token on every use — a second concurrent refresh
// with the old cookie would be rejected.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  try {
    // Bare axios instance: skips the 401 interceptor so we don't recurse.
    // The httpOnly refresh-token cookie is sent automatically by the browser.
    const res = await axios.post<{ success: boolean; data: { accessToken: string } }>(
      `${BASE_URL}/auth/refresh`,
      {},
      { headers: { "Content-Type": "application/json" }, withCredentials: true },
    );
    const { accessToken } = res.data.data;
    storeTokens(accessToken);
    return accessToken;
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

    // 401 that can't be recovered (retry also failed, or auth endpoint).
    if (status === 401 && !isAuthEndpoint) {
      redirectToLogin();
      return Promise.reject(err);
    }

    // ── No response: network offline / server unreachable ──────────────────
    if (!err.response) {
      err.message = "Network error — check your internet connection and try again.";
      return Promise.reject(err);
    }

    if (status === 429) {
      err.message = "Too many requests — please wait a moment and try again.";
      return Promise.reject(err);
    }

    if (status === 503) {
      err.message = "Service temporarily unavailable — please try again shortly.";
      return Promise.reject(err);
    }

    const serverMsg: string | undefined =
      err.response.data?.message ?? err.response.data?.error;
    if (serverMsg) err.message = serverMsg;

    return Promise.reject(err);
  },
);
