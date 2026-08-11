import { NextResponse } from "next/server";
import {
  buildGoogleAuthUrl,
  createOAuthState,
  isGoogleOAuthConfigured,
} from "@/lib/auth/google";

export const runtime = "nodejs";

export async function GET() {
  if (!isGoogleOAuthConfigured()) {
    return NextResponse.json(
      { error: "Google OAuth is not configured" },
      { status: 503 }
    );
  }
  const state = createOAuthState();
  const res = NextResponse.redirect(buildGoogleAuthUrl(state));
  res.cookies.set("curricumap_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
