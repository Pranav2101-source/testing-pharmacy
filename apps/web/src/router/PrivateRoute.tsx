import { useState, useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { clearUser, getAccessToken, getStoredUser } from "@/lib/auth";
import { initAuth } from "@/lib/api-client";

export function PrivateRoute() {
  const hasStoredSession = !!getAccessToken() || !!getStoredUser();

  // If the access token is already in memory (just logged in), skip the refresh
  // round-trip and render immediately.
  const [ready,  setReady]  = useState(!!getAccessToken());
  const [authed, setAuthed] = useState<boolean>(hasStoredSession);

  useEffect(() => {
    if (ready) return;                // already have a token — nothing to do
    if (!hasStoredSession) {          // no stored user → no point refreshing
      setReady(true);
      setAuthed(false);
      return;
    }
    // Stored user profile exists but no in-memory token → refresh silently
    // before the dashboard (and all its background queries) mount.
    initAuth().then((ok) => {
      setAuthed(ok);
      setReady(true);
      if (!ok) clearUser();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Spinner while the refresh is in-flight
  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="w-8 h-8 rounded-full border-2 border-violet-200 border-t-violet-600 animate-spin" />
      </div>
    );
  }

  if (!authed) {
    clearUser();
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
