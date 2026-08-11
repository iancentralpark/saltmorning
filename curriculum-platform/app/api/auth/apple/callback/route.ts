import { NextRequest, NextResponse } from "next/server";
import {
  exchangeAppleCode,
  isAppleOAuthConfigured,
  orgForEmail,
} from "@/lib/auth/apple";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";

export const runtime = "nodejs";

async function finishAppleLogin(
  req: NextRequest,
  code: string | null,
  state: string | null,
  err: string | null
) {
  if (!isAppleOAuthConfigured()) {
    return NextResponse.redirect(new URL("/?auth=oauth-disabled", req.url));
  }
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
    const user = await exchangeAppleCode(code);
    const orgCode = orgForEmail(user.email);
    const token = signSession({
      orgCode,
      role: "teacher",
      demoUserId: `apple:${user.sub}`,
      provider: "apple",
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
    res.cookies.set("curricumap_oauth_provider", "", {
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

/** Apple may redirect with query params in some configurations. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  return finishAppleLogin(
    req,
    url.searchParams.get("code"),
    url.searchParams.get("state"),
    url.searchParams.get("error")
  );
}

/** Preferred: response_mode=form_post */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const code = form?.get("code");
  const state = form?.get("state");
  const err = form?.get("error");
  return finishAppleLogin(
    req,
    typeof code === "string" ? code : null,
    typeof state === "string" ? state : null,
    typeof err === "string" ? err : null
  );
}
