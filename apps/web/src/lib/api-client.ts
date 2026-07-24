import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { clearSession, getAccessToken, storeTokens } from "./auth";

/**
 * Where the API lives. Single source of truth — this used to be copy-pasted into
 * four files, and every copy still pointed at port 4000, which was the OLD Node
 * backend. The Java backend listens on 8080 (see application.yml `server.port`),
 * so the fallback had been silently wrong since the rewrite.
 *
 * It only bites when VITE_API_URL is unset, which is exactly the fresh-clone case:
 * `.env.local` is gitignored, so a new checkout has no value, falls back to a port
 * nothing is listening on, and every request fails as "Network error" with no clue
 * why. Deployed environments always set VITE_API_URL (`/api/v1`, same-origin,
 * rewritten to the backend), so this default is a developer-experience fix.
 */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1";

const BASE_URL = API_BASE_URL;

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

/** Call once at app boot (from PrivateRoute) to pre-populate the in-memory
 *  access token from the httpOnly refresh-token cookie. Prevents the wave of
 *  401 → retry → success noise that happens when the dashboard mounts before
 *  any token is in memory. Returns true if a valid session exists.
 *
 *  Goes through the same single-flight refreshPromise as the 401 interceptor
 *  below, not its own independent axios call — React StrictMode (and, in
 *  production, simply having two tabs open) can invoke this twice in close
 *  succession, and since the backend rotates the refresh token on every use,
 *  a second concurrent call with the same now-stale cookie always 401s and
 *  bounces the user back to the landing page right after a successful login. */
export async function initAuth(): Promise<boolean> {
  if (getAccessToken()) return true;
  refreshPromise ??= refreshAccessToken().finally(() => { refreshPromise = null; });
  return (await refreshPromise) !== null;
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

/**
 * Extract a user-facing message from a caught request error.
 *
 * Prefers the backend's specific validation message, but falls back to the
 * friendlier message the response interceptor above already attaches for
 * network failures, CORS blocks, rate limiting, etc. — instead of dropping
 * straight to a generic fallback string that hides what actually went wrong.
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (!axios.isAxiosError(err)) return fallback;

  const status    = err.response?.status;
  const data      = err.response?.data as { error?: string; message?: string } | undefined;
  const serverMsg = data?.error ?? data?.message;

  // The backend's catch-all and its AccessDeniedException handler return these two
  // fixed strings by design (never leaking internals). They're correct as wire values
  // but tell the person reading the screen nothing about what to do next, so they're
  // the one case where a client-side message beats the server's.
  if (status === 403) {
    return "You don't have permission to do this. Ask an owner or manager for access.";
  }
  if (status && status >= 500 && (!serverMsg || serverMsg === "Internal server error")) {
    return "Something went wrong on our end. Please try again in a moment.";
  }

  return serverMsg ?? err.message ?? fallback;
}

/**
 * Same as {@link getErrorMessage}, but also recovers the reason from a FAILED
 * `responseType: "blob"` request.
 *
 * <p>A download sets responseType to blob, and axios applies that to the error
 * response too — so a perfectly good JSON body like
 * `{"error":"Export range cannot exceed 1 year"}` arrives as an unreadable Blob and
 * getErrorMessage falls through to the generic fallback. Every export in the app
 * therefore reported "Failed to export" no matter what the server actually said.
 * Reading the blob back to text costs one await and restores the real reason.
 *
 * <p>Async because Blob.text() is; use this for downloads, getErrorMessage everywhere else.
 */
export async function getDownloadErrorMessage(err: unknown, fallback: string): Promise<string> {
  if (axios.isAxiosError(err) && err.response?.data instanceof Blob) {
    try {
      const text = await err.response.data.text();
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      const msg = parsed.error ?? parsed.message;
      if (msg) return msg;
    } catch {
      // Not JSON (or unreadable) — fall through to the normal handling below.
    }
  }
  return getErrorMessage(err, fallback);
}
