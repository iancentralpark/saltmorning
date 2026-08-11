/**
 * Shared OAuth helpers (Google / Microsoft).
 */

import { randomBytes } from "crypto";
import { isDemoOrgCode } from "@/lib/auth/session";

export function defaultOAuthOrg() {
  const code = process.env.OAUTH_DEFAULT_ORG || "salt-morning";
  return isDemoOrgCode(code) ? code : "salt-morning";
}

/** Optional email→org map: "a@x.com:acme-academy,b@y.com:salt-morning" */
export function orgForEmail(email: string): string {
  const raw = process.env.OAUTH_EMAIL_ORG_MAP || "";
  const lower = email.trim().toLowerCase();
  for (const part of raw.split(",")) {
    const [addr, org] = part.split(":").map((s) => s.trim());
    if (addr && org && addr.toLowerCase() === lower && isDemoOrgCode(org)) {
      return org;
    }
  }
  return defaultOAuthOrg();
}

export function createOAuthState() {
  return randomBytes(16).toString("hex");
}

export type OAuthUser = {
  email: string;
  name: string;
  sub: string;
};
