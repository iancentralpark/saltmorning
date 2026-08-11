import {
  DEMO_ORGS,
  getSession,
  isDemoOrgCode,
  signSession,
  SESSION_COOKIE,
} from "@/lib/auth/session";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * Demo login — HMAC httpOnly cookie scoped to an organization.
 * Body: { orgCode: "salt-morning" | "acme-academy", role?: "teacher"|"admin", pin? }
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    orgCode?: string;
    role?: "teacher" | "admin";
    pin?: string;
  };

  const expectedPin = process.env.DEMO_LOGIN_PIN;
  if (expectedPin && body.pin !== expectedPin) {
    return Response.json({ error: "Invalid pin" }, { status: 401 });
  }

  const orgCode = String(body.orgCode || "").trim();
  if (!isDemoOrgCode(orgCode)) {
    return Response.json(
      {
        error: "Unknown orgCode",
        allowed: DEMO_ORGS.map((o) => o.code),
      },
      { status: 400 }
    );
  }

  const role = body.role === "admin" ? "admin" : "teacher";
  const token = signSession({
    orgCode,
    role,
    demoUserId: role === "admin" ? "demo-admin" : `demo-${orgCode}`,
  });

  const res = Response.json({
    ok: true,
    session: {
      orgCode,
      role,
      orgName: DEMO_ORGS.find((o) => o.code === orgCode)?.name,
    },
  });
  res.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`
  );
  return res;
}

export async function GET() {
  const session = await getSession();
  return Response.json({
    organizations: DEMO_ORGS,
    pinRequired: Boolean(process.env.DEMO_LOGIN_PIN),
    session: session
      ? {
          orgCode: session.orgCode,
          role: session.role,
          demoUserId: session.demoUserId,
          orgName: DEMO_ORGS.find((o) => o.code === session.orgCode)?.name,
        }
      : null,
  });
}
