import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "curricumap_session";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type DemoSession = {
  orgCode: string;
  role: "teacher" | "admin";
  demoUserId: string;
  exp: number;
  provider?: "demo" | "google" | "microsoft" | "apple";
  email?: string;
  displayName?: string;
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

export function authSecret() {
  return process.env.AUTH_SECRET || "curricumap-dev-secret";
}

function toBase64Url(bytes: Uint8Array) {
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
  // btoa available in Node 22 + Edge
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(s: string) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Node-sync sign (API routes). */
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

/** Sync verify for Node (API routes / smoke tests). */
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

/**
 * Edge-safe verify for middleware (Web Crypto).
 * Signature format matches Node createHmac(...).digest("base64url").
 */
export async function verifySessionEdge(
  token: string | undefined | null
): Promise<DemoSession | null> {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(authSecret()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const mac = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(data)
    );
    const expected = toBase64Url(new Uint8Array(mac));
    if (expected.length !== sig.length) return null;
    // constant-ish compare
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    }
    if (diff !== 0) return null;

    const json = new TextDecoder().decode(fromBase64Url(data));
    const body = JSON.parse(json) as DemoSession;
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
