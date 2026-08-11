import { NextResponse } from "next/server";
import {
  buildAppleAuthUrl,
  createOAuthState,
  isAppleOAuthConfigured,
} from "@/lib/auth/apple";

export const runtime = "nodejs";

export async function GET() {
  if (!isAppleOAuthConfigured()) {
    return NextResponse.json(
      { error: "Apple Sign In is not configured" },
      { status: 503 }
    );
  }
  const state = createOAuthState();
  const res = NextResponse.redirect(buildAppleAuthUrl(state));
  res.cookies.set("curricumap_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  res.cookies.set("curricumap_oauth_provider", "apple", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
