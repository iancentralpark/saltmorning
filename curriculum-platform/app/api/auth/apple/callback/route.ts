import { NextRequest, NextResponse } from "next/server";
import {
  exchangeAppleCode,
  isAppleOAuthConfigured,
} from "@/lib/auth/apple";
import { finishOAuthSession, readOAuthState } from "@/lib/auth/oauth-flow";

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
  const expected = readOAuthState(req);
  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/?auth=invalid-state", req.url));
  }

  try {
    const user = await exchangeAppleCode(code);
    return finishOAuthSession(req, user, "apple");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "oauth-failed";
    return NextResponse.redirect(
      new URL(`/?auth=error&error=${encodeURIComponent(msg)}`, req.url)
    );
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  return finishAppleLogin(
    req,
    url.searchParams.get("code"),
    url.searchParams.get("state"),
    url.searchParams.get("error")
  );
}

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
