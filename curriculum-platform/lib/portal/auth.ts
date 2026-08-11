import { NextRequest } from "next/server";

export type PortalContext = {
  organizationCode: string | null;
};

/** Simple API-key gate for external teacher portals. */
export function assertPortalAuth(req: NextRequest): Response | null {
  const expected = process.env.PORTAL_API_KEY;
  if (!expected) {
    // Dev-friendly: allow when key not configured
    return null;
  }
  const provided =
    req.headers.get("x-api-key") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (provided !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Optional org claim for multi-tenant portal calls.
 * Header: x-organization-code
 * When PORTAL_REQUIRE_ORG=1 and API key is set, org header is required.
 */
export function resolvePortalContext(req: NextRequest): PortalContext | Response {
  const organizationCode =
    req.headers.get("x-organization-code")?.trim() ||
    new URL(req.url).searchParams.get("org")?.trim() ||
    null;

  const requireOrg =
    process.env.PORTAL_REQUIRE_ORG === "1" ||
    process.env.PORTAL_REQUIRE_ORG === "true";

  if (requireOrg && process.env.PORTAL_API_KEY && !organizationCode) {
    return Response.json(
      { error: "x-organization-code header required" },
      { status: 400 }
    );
  }

  return { organizationCode };
}

export function assertCronAuth(req: NextRequest): Response | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 }
    );
  }
  const provided =
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
