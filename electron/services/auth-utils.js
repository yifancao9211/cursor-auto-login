/**
 * Pure utility functions for auth/token operations.
 * Extracted from main.js for testability.
 */
import crypto from "node:crypto";

/**
 * Check if a JWT token (or URL-encoded cookie userId::jwt) is expired.
 * Returns false (conservative) when unable to parse.
 */
export function isTokenExpired(token) {
  if (!token) return true;
  try {
    let jwt = token;
    const decoded = decodeURIComponent(token);
    const idx = decoded.indexOf("::");
    if (idx > 0) jwt = decoded.substring(idx + 2);
    const segs = jwt.split(".");
    if (segs.length !== 3) return false;
    let b64 = segs[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const payload = JSON.parse(Buffer.from(b64, "base64").toString());
    if (!payload.exp) return false;
    return Date.now() / 1000 > payload.exp;
  } catch {
    return false;
  }
}

/**
 * Check if an account has any non-expired credentials.
 */
export function hasValidCredentials(acc) {
  if (acc.token && !isTokenExpired(acc.token)) return true;
  if (acc.access_token && !isTokenExpired(acc.access_token)) return true;
  if (acc.refresh_token) return true;
  return false;
}

/**
 * Extract JWT from a URL-encoded cookie (userId::jwt format).
 */
export function extractJwt(token) {
  if (!token) return null;
  const decoded = decodeURIComponent(token);
  const parts = decoded.split("::");
  return parts.length >= 2 ? parts[1] : parts[0];
}

/**
 * Generate PKCE code verifier, challenge, and UUID.
 */
export function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const uuid = crypto.randomUUID();
  return { verifier, challenge, uuid };
}
