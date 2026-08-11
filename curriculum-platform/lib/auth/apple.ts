/**
 * Sign in with Apple (optional).
 * Requires APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (PEM).
 */

import { createHash, createSign, randomUUID } from "crypto";
import {
  createOAuthState,
  orgForEmail,
  type OAuthUser,
} from "@/lib/auth/oauth-shared";

export { createOAuthState, orgForEmail };

export function isAppleOAuthConfigured() {
  return Boolean(
    process.env.APPLE_CLIENT_ID?.trim() &&
      process.env.APPLE_TEAM_ID?.trim() &&
      process.env.APPLE_KEY_ID?.trim() &&
      process.env.APPLE_PRIVATE_KEY?.trim()
  );
}

export function appleRedirectUri() {
  return (
    process.env.APPLE_REDIRECT_URI ||
    "http://localhost:3000/api/auth/apple/callback"
  );
}

function applePrivateKeyPem() {
  const raw = process.env.APPLE_PRIVATE_KEY || "";
  // Support single-line env with \n escapes
  return raw.includes("BEGIN") ? raw.replace(/\\n/g, "\n") : raw;
}

/** Base64url without padding */
function b64url(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64url");
}

/**
 * Apple client_secret is a short-lived ES256 JWT signed with the .p8 key.
 * https://developer.apple.com/documentation/signinwithapplerestapi/generate_and_validate_tokens
 */
export function createAppleClientSecret() {
  const teamId = process.env.APPLE_TEAM_ID || "";
  const clientId = process.env.APPLE_CLIENT_ID || "";
  const keyId = process.env.APPLE_KEY_ID || "";
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(
    JSON.stringify({ alg: "ES256", kid: keyId })
  );
  const payload = b64url(
    JSON.stringify({
      iss: teamId,
      iat: now,
      exp: now + 60 * 60 * 24 * 150, // ≤ 6 months
      aud: "https://appleid.apple.com",
      sub: clientId,
    })
  );
  const data = `${header}.${payload}`;
  const signer = createSign("SHA256");
  signer.update(data);
  signer.end();
  // Apple requires IEEE-P1363 (r||s) signature, not DER — Node dsaEncoding
  const sig = signer.sign({
    key: applePrivateKeyPem(),
    dsaEncoding: "ieee-p1363",
  });
  return `${data}.${b64url(sig)}`;
}

export function buildAppleAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: process.env.APPLE_CLIENT_ID || "",
    redirect_uri: appleRedirectUri(),
    response_type: "code",
    // name+email requires form_post on Apple's side
    response_mode: "form_post",
    scope: "name email",
    state,
  });
  return `https://appleid.apple.com/auth/authorize?${params.toString()}`;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length < 2) throw new Error("Invalid Apple id_token");
  const json = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
}

export async function exchangeAppleCode(code: string): Promise<OAuthUser> {
  const body = new URLSearchParams({
    client_id: process.env.APPLE_CLIENT_ID || "",
    client_secret: createAppleClientSecret(),
    code,
    grant_type: "authorization_code",
    redirect_uri: appleRedirectUri(),
  });
  const tokenRes = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenJson = (await tokenRes.json()) as {
    id_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenRes.ok || !tokenJson.id_token) {
    throw new Error(
      tokenJson.error_description ||
        tokenJson.error ||
        "Apple token exchange failed"
    );
  }

  const claims = decodeJwtPayload(tokenJson.id_token);
  const sub = String(claims.sub || "");
  const email =
    (typeof claims.email === "string" && claims.email) ||
    `${sub || randomUUID()}@privaterelay.appleid.com`;
  if (!sub) throw new Error("Apple id_token missing sub");

  return {
    email,
    name: email.split("@")[0] || "Apple user",
    sub: sub || createHash("sha256").update(email).digest("hex").slice(0, 16),
  };
}
