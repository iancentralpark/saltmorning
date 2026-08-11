import { NextRequest, NextResponse } from "next/server";
import {
  buildAppleAuthUrl,
  createOAuthState,
  isAppleOAuthConfigured,
} from "@/lib/auth/apple";
import { beginOAuthRedirect } from "@/lib/auth/oauth-flow";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAppleOAuthConfigured()) {
    return NextResponse.json(
      { error: "Apple Sign In is not configured" },
      { status: 503 }
    );
  }
  const state = createOAuthState();
  return beginOAuthRedirect(req, buildAppleAuthUrl(state), state, "apple");
}
