import { NextRequest, NextResponse } from "next/server";
import {
  exchangeGoogleCode,
  isGoogleOAuthConfigured,
} from "@/lib/auth/google";
import { finishOAuthSession, readOAuthState } from "@/lib/auth/oauth-flow";

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

  const expected = readOAuthState(req);
  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/?auth=invalid-state", req.url));
  }

  try {
    const user = await exchangeGoogleCode(code);
    return finishOAuthSession(req, user, "google");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "oauth-failed";
    return NextResponse.redirect(
      new URL(`/?auth=error&error=${encodeURIComponent(msg)}`, req.url)
    );
  }
}
