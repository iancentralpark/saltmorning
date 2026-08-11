import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionEdge } from "@/lib/auth/session";

/**
 * When AUTH_REQUIRED=1, require a valid session cookie for teacher UI routes.
 * Portal / cron / auth / health / docs stay open.
 */
export async function middleware(req: NextRequest) {
  if (process.env.AUTH_REQUIRED !== "1" && process.env.AUTH_REQUIRED !== "true") {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  const publicPrefixes = [
    "/api/auth",
    "/api/health",
    "/api/portal",
    "/api/cron",
    "/api/organizations",
    "/docs",
    "/_next",
    "/favicon",
  ];
  if (
    pathname === "/" ||
    publicPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return NextResponse.next();
  }

  if (/\.(png|jpg|jpeg|gif|svg|ico|css|js|map|woff2?)$/i.test(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionEdge(token)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const login = new URL("/", req.url);
  login.searchParams.set("auth", "required");
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
