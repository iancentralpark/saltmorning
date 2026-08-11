import { NextRequest, NextResponse } from "next/server";
import {
  buildMicrosoftAuthUrl,
  createOAuthState,
  isMicrosoftOAuthConfigured,
} from "@/lib/auth/microsoft";
import { beginOAuthRedirect } from "@/lib/auth/oauth-flow";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isMicrosoftOAuthConfigured()) {
    return NextResponse.json(
      { error: "Microsoft OAuth is not configured" },
      { status: 503 }
    );
  }
  const state = createOAuthState();
  return beginOAuthRedirect(
    req,
    buildMicrosoftAuthUrl(state),
    state,
    "microsoft"
  );
}
