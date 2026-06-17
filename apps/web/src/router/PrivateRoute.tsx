import { Navigate, Outlet } from "react-router-dom";
import { clearUser, getAccessToken, getStoredUser } from "@/lib/auth";

export function PrivateRoute() {
  // Allow access if either:
  //   • getAccessToken() — token is in memory (just logged in / registered)
  //   • getStoredUser() — user profile in localStorage (page reload; first
  //                        API call will transparently refresh via httpOnly cookie)
  // Both are null only when the user has never logged in or has been logged out.
  const hasSession = !!getAccessToken() || !!getStoredUser();
  if (!hasSession) {
    clearUser();
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
