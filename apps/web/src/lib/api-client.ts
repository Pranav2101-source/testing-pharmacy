import axios from "axios";
import { clearUser } from "./auth";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:4000/api",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // ── 401: session expired or revoked ────────────────────────────────────
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      clearUser();
      document.cookie = "auth-token=; path=/; max-age=0; SameSite=Lax";
      window.location.href = "/login";
      return Promise.reject(err);
    }

    // ── No response: network offline / server unreachable ──────────────────
    if (!err.response) {
      err.message = "Network error — check your internet connection and try again.";
      return Promise.reject(err);
    }

    // ── 429: global rate limit hit ─────────────────────────────────────────
    if (err.response.status === 429) {
      err.message = "Too many requests — please wait a moment and try again.";
      return Promise.reject(err);
    }

    // ── 503: server / DB temporarily unavailable ───────────────────────────
    if (err.response.status === 503) {
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
