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
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      clearUser();
      document.cookie = "auth-token=; path=/; max-age=0; SameSite=Lax";
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);
