/**
 * Google OAuth helpers (optional — enabled when client id/secret are set).
 */

import { createHash } from "crypto";
import {
  createOAuthState,
  orgForEmail,
  defaultOAuthOrg,
  type OAuthUser,
} from "@/lib/auth/oauth-shared";

export { createOAuthState, orgForEmail, defaultOAuthOrg };

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

export async function exchangeGoogleCode(code: string): Promise<OAuthUser> {
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

  const userRes = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { Authorization: `Bearer ${tokenJson.access_token}` } }
  );
  const user = (await userRes.json()) as {
    sub?: string;
    email?: string;
    name?: string;
  };
  if (!userRes.ok || !user.email) {
    throw new Error("Could not load Google userinfo");
  }
  return {
    email: user.email,
    name: user.name || user.email,
    sub:
      user.sub ||
      createHash("sha256").update(user.email).digest("hex").slice(0, 16),
  };
}
