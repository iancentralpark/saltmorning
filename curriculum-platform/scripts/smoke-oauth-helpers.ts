/**
 * Smoke: OAuth helper path safety + org mapping (no live IdP).
 */
import assert from "node:assert/strict";
import { orgForEmail, safeNextPath } from "../lib/auth/oauth-shared";

assert.equal(safeNextPath("/schedule"), "/schedule");
assert.equal(safeNextPath("//evil.com"), "/map");
assert.equal(safeNextPath("https://evil.com"), "/map");
assert.equal(safeNextPath(null), "/map");

process.env.OAUTH_EMAIL_ORG_MAP = "t@acme.edu:acme-academy";
process.env.OAUTH_DEFAULT_ORG = "salt-morning";
assert.equal(orgForEmail("t@acme.edu"), "acme-academy");
assert.equal(orgForEmail("other@x.com"), "salt-morning");

console.log("✓ oauth helpers smoke OK");
