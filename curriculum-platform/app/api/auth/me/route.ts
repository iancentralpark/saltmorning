import { DEMO_ORGS, getSession } from "@/lib/auth/session";
import { isGoogleOAuthConfigured } from "@/lib/auth/google";
import { isMicrosoftOAuthConfigured } from "@/lib/auth/microsoft";
import { isAppleOAuthConfigured } from "@/lib/auth/apple";

export const runtime = "nodejs";

function oauthFlags() {
  return {
    google: isGoogleOAuthConfigured(),
    microsoft: isMicrosoftOAuthConfigured(),
    apple: isAppleOAuthConfigured(),
  };
}

export async function GET() {
  const session = await getSession();
  const oauth = oauthFlags();
  const base = {
    oauthConfigured: oauth.google || oauth.microsoft || oauth.apple,
    oauth,
    authRequired:
      process.env.AUTH_REQUIRED === "1" ||
      process.env.AUTH_REQUIRED === "true",
  };
  if (!session) {
    return Response.json({
      authenticated: false,
      session: null,
      ...base,
    });
  }
  return Response.json({
    authenticated: true,
    ...base,
    session: {
      orgCode: session.orgCode,
      role: session.role,
      demoUserId: session.demoUserId,
      provider: session.provider || "demo",
      email: session.email || null,
      displayName: session.displayName || null,
      orgName: DEMO_ORGS.find((o) => o.code === session.orgCode)?.name,
      exp: session.exp,
    },
  });
}
