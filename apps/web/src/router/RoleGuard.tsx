import { Navigate, Outlet } from "react-router-dom";
import { getStoredUser } from "@/lib/auth";

interface RoleGuardProps {
  allow: string[];
  redirectTo?: string;
}

export function RoleGuard({ allow, redirectTo = "/dashboard" }: RoleGuardProps) {
  const user = getStoredUser();
  if (!user || !allow.includes(user.role)) {
    return <Navigate to={redirectTo} replace />;
  }
  return <Outlet />;
}
