import { Navigate, Outlet } from "react-router-dom";
import { clearUser } from "@/lib/auth";

export function PrivateRoute() {
  const token = localStorage.getItem("token");
  if (!token) {
    clearUser();
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
