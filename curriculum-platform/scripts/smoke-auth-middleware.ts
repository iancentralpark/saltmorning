/**
 * Smoke: AUTH_REQUIRED middleware helpers (session edge + safe next).
 */
import assert from "node:assert/strict";
import {
  signSession,
  verifySession,
  verifySessionEdge,
} from "../lib/auth/session";
import { safeNextPath } from "../lib/auth/oauth-shared";

async function main() {
  const token = signSession({
    orgCode: "salt-morning",
    role: "teacher",
    demoUserId: "auth-smoke",
    provider: "demo",
  });
  assert.ok(verifySession(token));
  assert.ok(await verifySessionEdge(token));
  assert.equal(
    safeNextPath("/map?framework=ccss-math"),
    "/map?framework=ccss-math"
  );
  assert.equal(safeNextPath("/\\evil"), "/map");
  console.log("✓ auth middleware helpers smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
