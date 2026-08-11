import { NextRequest, NextResponse } from "next/server";
import {
  OAUTH_NEXT_COOKIE,
  OAUTH_PROVIDER_COOKIE,
  OAUTH_STATE_COOKIE,
  safeNextPath,
  type OAuthUser,
} from "@/lib/auth/oauth-shared";
import { orgForEmail } from "@/lib/auth/oauth-shared";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";

export function oauthCookieOptions(maxAge = 600) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export function beginOAuthRedirect(
  req: NextRequest,
  authUrl: string,
  state: string,
  provider: "google" | "microsoft" | "apple"
) {
  const next = safeNextPath(
    new URL(req.url).searchParams.get("next") ||
      req.cookies.get(OAUTH_NEXT_COOKIE)?.value
  );
  const res = NextResponse.redirect(authUrl);
  res.cookies.set(OAUTH_STATE_COOKIE, state, oauthCookieOptions());
  res.cookies.set(OAUTH_PROVIDER_COOKIE, provider, oauthCookieOptions());
  res.cookies.set(OAUTH_NEXT_COOKIE, next, oauthCookieOptions());
  return res;
}

export function finishOAuthSession(
  req: NextRequest,
  user: OAuthUser,
  provider: "google" | "microsoft" | "apple"
) {
  const orgCode = orgForEmail(user.email);
  const token = signSession({
    orgCode,
    role: "teacher",
    demoUserId: `${provider}:${user.sub}`,
    provider,
    email: user.email,
    displayName: user.name,
  });
  const next = safeNextPath(req.cookies.get(OAUTH_NEXT_COOKIE)?.value, "/map");
  const res = NextResponse.redirect(new URL(next, req.url));
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  for (const name of [
    OAUTH_STATE_COOKIE,
    OAUTH_PROVIDER_COOKIE,
    OAUTH_NEXT_COOKIE,
  ]) {
    res.cookies.set(name, "", { httpOnly: true, path: "/", maxAge: 0 });
  }
  return res;
}

export function readOAuthState(req: NextRequest) {
  return req.cookies.get(OAUTH_STATE_COOKIE)?.value;
}
