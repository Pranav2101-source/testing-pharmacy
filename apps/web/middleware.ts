import { NextRequest, NextResponse } from "next/server";

const AUTH_PATHS = ["/login", "/register", "/forgot-password"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("auth-token")?.value;

  const isDashboard = pathname.startsWith("/dashboard");
  const isAuthPage  = AUTH_PATHS.some(p => pathname === p || pathname.startsWith(p + "/"));
  const isRoot      = pathname === "/";

  // Unauthenticated user trying to reach dashboard → landing page
  if (isDashboard && !token) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Authenticated user on landing page or auth pages → dashboard home
  if ((isRoot || isAuthPage) && token) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/login",
    "/register",
    "/forgot-password",
  ],
};
