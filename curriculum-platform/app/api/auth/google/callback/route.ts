import { NextRequest, NextResponse } from "next/server";
import {
  exchangeGoogleCode,
  isGoogleOAuthConfigured,
  orgForEmail,
} from "@/lib/auth/google";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isGoogleOAuthConfigured()) {
    return NextResponse.redirect(new URL("/?auth=oauth-disabled", req.url));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  if (err) {
    return NextResponse.redirect(
      new URL(`/?auth=denied&error=${encodeURIComponent(err)}`, req.url)
    );
  }

  const expected = req.cookies.get("curricumap_oauth_state")?.value;
  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/?auth=invalid-state", req.url));
  }

  try {
    const user = await exchangeGoogleCode(code);
    const orgCode = orgForEmail(user.email);
    const token = signSession({
      orgCode,
      role: "teacher",
      demoUserId: `google:${user.sub}`,
      provider: "google",
      email: user.email,
      displayName: user.name,
    });

    const res = NextResponse.redirect(new URL("/map", req.url));
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    res.cookies.set("curricumap_oauth_state", "", {
      httpOnly: true,
      path: "/",
      maxAge: 0,
    });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "oauth-failed";
    return NextResponse.redirect(
      new URL(`/?auth=error&error=${encodeURIComponent(msg)}`, req.url)
    );
  }
}
