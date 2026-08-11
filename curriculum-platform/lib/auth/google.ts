/**
 * Google OAuth helpers (optional — enabled when client id/secret are set).
 * Sessions still use the shared HMAC cookie from lib/auth/session.ts.
 */

import { createHash, randomBytes } from "crypto";
import { isDemoOrgCode } from "@/lib/auth/session";

export function isGoogleOAuthConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

export function googleRedirectUri() {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    "http://localhost:3000/api/auth/google/callback"
  );
}

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

export function buildGoogleAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    include_granted_scopes: "true",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(code: string) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
  });
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(
      tokenJson.error_description ||
        tokenJson.error ||
        "Google token exchange failed"
    );
  }

  const userRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const user = (await userRes.json()) as {
    sub?: string;
    email?: string;
    name?: string;
    email_verified?: boolean;
  };
  if (!userRes.ok || !user.email) {
    throw new Error("Could not load Google userinfo");
  }
  return {
    email: user.email,
    name: user.name || user.email,
    sub: user.sub || createHash("sha256").update(user.email).digest("hex").slice(0, 16),
  };
}
