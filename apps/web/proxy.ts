import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC = [
  "/login",
  "/register",
  "/accept-invitation",
  "/api/auth",
  "/api/webhooks",
  "/api/health",
  "/api/internal", // cron/worker endpoints authenticate with their own bearer secret
  "/api/oauth/linkedin/callback",
  "/api/oauth/meta/callback",
];

/**
 * Edge-side gate: redirects unauthenticated browser requests to /login and
 * rejects unauthenticated API calls. Real authorization happens server-side
 * (lib/session.ts); this only avoids rendering private pages for anonymous
 * visitors.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }
  const hasSession = !!getSessionCookie(req);
  if (hasSession) return NextResponse.next();
  if (pathname.startsWith("/api/"))
    return NextResponse.json({ error: "unauthenticated", message: "Authentication required" }, { status: 401 });
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
