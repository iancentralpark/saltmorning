/**
 * Microsoft (Entra ID / Azure AD) OAuth helpers.
 * Enabled when MICROSOFT_CLIENT_ID + MICROSOFT_CLIENT_SECRET are set.
 */

import { createHash } from "crypto";
import {
  createOAuthState,
  orgForEmail,
  type OAuthUser,
} from "@/lib/auth/oauth-shared";

export { createOAuthState, orgForEmail };

export function isMicrosoftOAuthConfigured() {
  return Boolean(
    process.env.MICROSOFT_CLIENT_ID?.trim() &&
      process.env.MICROSOFT_CLIENT_SECRET?.trim()
  );
}

export function microsoftTenant() {
  return process.env.MICROSOFT_TENANT_ID?.trim() || "common";
}

export function microsoftRedirectUri() {
  return (
    process.env.MICROSOFT_REDIRECT_URI ||
    "http://localhost:3000/api/auth/microsoft/callback"
  );
}

export function buildMicrosoftAuthUrl(state: string) {
  const tenant = microsoftTenant();
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID || "",
    response_type: "code",
    redirect_uri: microsoftRedirectUri(),
    response_mode: "query",
    scope: "openid email profile User.Read",
    state,
  });
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeMicrosoftCode(code: string): Promise<OAuthUser> {
  const tenant = microsoftTenant();
  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID || "",
    client_secret: process.env.MICROSOFT_CLIENT_SECRET || "",
    code,
    redirect_uri: microsoftRedirectUri(),
    grant_type: "authorization_code",
    scope: "openid email profile User.Read",
  });
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }
  );
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(
      tokenJson.error_description ||
        tokenJson.error ||
        "Microsoft token exchange failed"
    );
  }

  const userRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const user = (await userRes.json()) as {
    id?: string;
    mail?: string;
    userPrincipalName?: string;
    displayName?: string;
  };
  const email = user.mail || user.userPrincipalName;
  if (!userRes.ok || !email) {
    throw new Error("Could not load Microsoft Graph profile");
  }
  return {
    email,
    name: user.displayName || email,
    sub:
      user.id ||
      createHash("sha256").update(email).digest("hex").slice(0, 16),
  };
}
