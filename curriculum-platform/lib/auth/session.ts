import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "curricumap_session";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type DemoSession = {
  orgCode: string;
  role: "teacher" | "admin";
  demoUserId: string;
  exp: number;
};

export const DEMO_ORGS = [
  {
    code: "salt-morning",
    name: "Salt Morning Academy",
    timezone: "Asia/Seoul",
  },
  {
    code: "acme-academy",
    name: "Acme Academy",
    timezone: "America/Los_Angeles",
  },
] as const;

function authSecret() {
  return process.env.AUTH_SECRET || "curricumap-dev-secret";
}

export function signSession(
  payload: Omit<DemoSession, "exp"> & { exp?: number }
): string {
  const body: DemoSession = {
    ...payload,
    exp: payload.exp ?? Date.now() + TOKEN_TTL_MS,
  };
  const data = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = createHmac("sha256", authSecret())
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

export function verifySession(token: string | undefined | null): DemoSession | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = createHmac("sha256", authSecret())
    .update(data)
    .digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const body = JSON.parse(
      Buffer.from(data, "base64url").toString("utf8")
    ) as DemoSession;
    if (!body.orgCode || !body.role || !body.exp) return null;
    if (Date.now() > body.exp) return null;
    return body;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<DemoSession | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

export function sessionCookieOptions(maxAgeSec = TOKEN_TTL_MS / 1000) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(maxAgeSec),
  };
}

export function isDemoOrgCode(code: string) {
  return DEMO_ORGS.some((o) => o.code === code);
}

/** When a session is present, private packs outside the org stay hidden. */
export function filterFrameworksForSession<
  T extends { organizationCode?: string | null; isPublic?: boolean },
>(frameworks: T[], session: DemoSession | null, requestedOrg?: string | null): T[] {
  const org =
    session?.role === "admin"
      ? requestedOrg || "all"
      : session?.orgCode || requestedOrg || "all";

  if (!org || org === "all") {
    if (session?.role === "teacher") {
      // Teachers never see other orgs' private packs
      return frameworks.filter(
        (f) =>
          (f.isPublic !== false && !f.organizationCode) ||
          f.organizationCode === session.orgCode
      );
    }
    return frameworks;
  }

  if (org === "public") {
    return frameworks.filter(
      (f) => f.isPublic !== false && !f.organizationCode
    );
  }

  return frameworks.filter(
    (f) =>
      (f.isPublic !== false && !f.organizationCode) ||
      f.organizationCode === org
  );
}
