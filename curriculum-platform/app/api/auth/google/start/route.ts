import { NextRequest, NextResponse } from "next/server";
import {
  buildGoogleAuthUrl,
  createOAuthState,
  isGoogleOAuthConfigured,
} from "@/lib/auth/google";
import { beginOAuthRedirect } from "@/lib/auth/oauth-flow";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isGoogleOAuthConfigured()) {
    return NextResponse.json(
      { error: "Google OAuth is not configured" },
      { status: 503 }
    );
  }
  const state = createOAuthState();
  return beginOAuthRedirect(req, buildGoogleAuthUrl(state), state, "google");
}
