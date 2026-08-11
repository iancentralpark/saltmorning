import { DEMO_ORGS, getSession } from "@/lib/auth/session";
import { isGoogleOAuthConfigured } from "@/lib/auth/google";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({
      authenticated: false,
      session: null,
      oauthConfigured: isGoogleOAuthConfigured(),
      authRequired:
        process.env.AUTH_REQUIRED === "1" ||
        process.env.AUTH_REQUIRED === "true",
    });
  }
  return Response.json({
    authenticated: true,
    oauthConfigured: isGoogleOAuthConfigured(),
    authRequired:
      process.env.AUTH_REQUIRED === "1" ||
      process.env.AUTH_REQUIRED === "true",
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
