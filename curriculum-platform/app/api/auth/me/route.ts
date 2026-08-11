import { DEMO_ORGS, getSession } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ authenticated: false, session: null });
  }
  return Response.json({
    authenticated: true,
    session: {
      orgCode: session.orgCode,
      role: session.role,
      demoUserId: session.demoUserId,
      orgName: DEMO_ORGS.find((o) => o.code === session.orgCode)?.name,
      exp: session.exp,
    },
  });
}
