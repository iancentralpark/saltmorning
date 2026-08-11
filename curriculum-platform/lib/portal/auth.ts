import { NextRequest } from "next/server";

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
