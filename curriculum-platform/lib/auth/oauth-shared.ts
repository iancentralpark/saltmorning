/**
 * Shared OAuth helpers (Google / Microsoft / Apple).
 */

import { randomBytes } from "crypto";
import { isDemoOrgCode } from "@/lib/auth/session";

export const OAUTH_STATE_COOKIE = "curricumap_oauth_state";
export const OAUTH_PROVIDER_COOKIE = "curricumap_oauth_provider";
export const OAUTH_NEXT_COOKIE = "curricumap_oauth_next";

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

/** Only allow same-origin relative paths (open-redirect safe). */
export function safeNextPath(raw: string | null | undefined, fallback = "/map") {
  if (!raw) return fallback;
  const v = raw.trim();
  if (
    !v.startsWith("/") ||
    v.startsWith("//") ||
    v.includes("://") ||
    v.includes("\\") ||
    v.includes("\0")
  ) {
    return fallback;
  }
  return v;
}

export type OAuthUser = {
  email: string;
  name: string;
  sub: string;
};
