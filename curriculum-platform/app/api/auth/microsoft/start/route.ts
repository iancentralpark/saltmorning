import { NextResponse } from "next/server";
import {
  buildMicrosoftAuthUrl,
  createOAuthState,
  isMicrosoftOAuthConfigured,
} from "@/lib/auth/microsoft";

export const runtime = "nodejs";

export async function GET() {
  if (!isMicrosoftOAuthConfigured()) {
    return NextResponse.json(
      { error: "Microsoft OAuth is not configured" },
      { status: 503 }
    );
  }
  const state = createOAuthState();
  const res = NextResponse.redirect(buildMicrosoftAuthUrl(state));
  res.cookies.set("curricumap_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  res.cookies.set("curricumap_oauth_provider", "microsoft", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
