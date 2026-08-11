/**
 * Smoke: demo session tenancy filters private packs.
 */
import assert from "node:assert/strict";
import {
  filterFrameworksForSession,
  signSession,
  verifySession,
  type DemoSession,
} from "../lib/auth/session";

const packs = [
  { code: "ccss-math", organizationCode: null, isPublic: true },
  {
    code: "custom-acme-sel",
    organizationCode: "acme-academy",
    isPublic: false,
  },
];

const token = signSession({
  orgCode: "salt-morning",
  role: "teacher",
  demoUserId: "demo-salt-morning",
  provider: "demo",
});
const session = verifySession(token) as DemoSession;
assert.equal(session.orgCode, "salt-morning");
assert.equal(session.provider, "demo");

const googleShaped = verifySession(
  signSession({
    orgCode: "acme-academy",
    role: "teacher",
    demoUserId: "google:abc",
    provider: "google",
    email: "t@acme.edu",
    displayName: "Teacher",
  })
) as DemoSession;
assert.equal(googleShaped.provider, "google");
assert.equal(googleShaped.email, "t@acme.edu");

const saltView = filterFrameworksForSession(packs, session, "all");
assert.equal(saltView.some((p) => p.code === "custom-acme-sel"), false);
assert.equal(saltView.some((p) => p.code === "ccss-math"), true);

const acmeSession = verifySession(
  signSession({
    orgCode: "acme-academy",
    role: "teacher",
    demoUserId: "demo-acme",
  })
) as DemoSession;
const acmeView = filterFrameworksForSession(packs, acmeSession, "all");
assert.equal(acmeView.some((p) => p.code === "custom-acme-sel"), true);

console.log("✓ session tenancy smoke OK");
