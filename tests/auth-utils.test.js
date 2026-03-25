import { describe, it, expect } from "vitest";
import { isTokenExpired, hasValidCredentials, extractJwt, generatePKCE } from "../electron/services/auth-utils.js";

function makeJwt(payload, expOverride) {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = Buffer.from(JSON.stringify({ ...payload, ...(expOverride !== undefined ? { exp: expOverride } : {}) })).toString("base64url");
  return `${header}.${body}.fakesig`;
}

describe("isTokenExpired", () => {
  it("returns true for null/empty", () => {
    expect(isTokenExpired(null)).toBe(true);
    expect(isTokenExpired("")).toBe(true);
    expect(isTokenExpired(undefined)).toBe(true);
  });

  it("returns false for non-expired JWT", () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const jwt = makeJwt({ sub: "user" }, futureExp);
    expect(isTokenExpired(jwt)).toBe(false);
  });

  it("returns true for expired JWT", () => {
    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    const jwt = makeJwt({ sub: "user" }, pastExp);
    expect(isTokenExpired(jwt)).toBe(true);
  });

  it("handles userId::jwt cookie format", () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const jwt = makeJwt({ sub: "user" }, futureExp);
    const cookie = encodeURIComponent(`user_01ABC::${jwt}`);
    expect(isTokenExpired(cookie)).toBe(false);
  });

  it("returns false (conservative) for malformed tokens", () => {
    expect(isTokenExpired("not-a-jwt")).toBe(false);
    expect(isTokenExpired("a.b")).toBe(false);
  });

  it("returns false when no exp claim", () => {
    const jwt = makeJwt({ sub: "user" }); // no exp
    expect(isTokenExpired(jwt)).toBe(false);
  });
});

describe("hasValidCredentials", () => {
  it("returns true when token is not expired", () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    expect(hasValidCredentials({ token: makeJwt({}, futureExp) })).toBe(true);
  });

  it("returns true when access_token is not expired", () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    expect(hasValidCredentials({ access_token: makeJwt({}, futureExp) })).toBe(true);
  });

  it("returns true when refresh_token exists (regardless of expiry)", () => {
    expect(hasValidCredentials({ refresh_token: "some-refresh-token" })).toBe(true);
  });

  it("returns false when all tokens are expired and no refresh", () => {
    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    expect(hasValidCredentials({ token: makeJwt({}, pastExp), access_token: makeJwt({}, pastExp) })).toBe(false);
  });

  it("returns false for empty account", () => {
    expect(hasValidCredentials({})).toBe(false);
  });

  it("returns false when refresh_token exists but _refreshInvalid is true", () => {
    expect(hasValidCredentials({ refresh_token: "some-refresh-token", _refreshInvalid: true })).toBe(false);
  });

  it("returns true when _refreshInvalid but token is still valid", () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    expect(hasValidCredentials({ token: makeJwt({}, futureExp), refresh_token: "x", _refreshInvalid: true })).toBe(true);
  });
});

describe("extractJwt", () => {
  it("returns null for null/empty", () => {
    expect(extractJwt(null)).toBe(null);
    expect(extractJwt("")).toBe(null);
  });

  it("extracts JWT from userId::jwt cookie format", () => {
    const cookie = encodeURIComponent("user_01ABC::eyJhbGciOiJIUzI1NiJ9.test.sig");
    expect(extractJwt(cookie)).toBe("eyJhbGciOiJIUzI1NiJ9.test.sig");
  });

  it("returns token as-is when no :: separator", () => {
    expect(extractJwt("plain-token-value")).toBe("plain-token-value");
  });
});

describe("generatePKCE", () => {
  it("produces verifier, challenge, and uuid", () => {
    const pkce = generatePKCE();
    expect(pkce.verifier).toBeDefined();
    expect(pkce.challenge).toBeDefined();
    expect(pkce.uuid).toBeDefined();
    expect(pkce.verifier.length).toBeGreaterThan(20);
  });

  it("generates unique values each time", () => {
    const a = generatePKCE();
    const b = generatePKCE();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.uuid).not.toBe(b.uuid);
  });

  it("challenge is SHA256 of verifier in base64url", () => {
    const crypto = require("node:crypto");
    const pkce = generatePKCE();
    const expected = crypto.createHash("sha256").update(pkce.verifier).digest("base64url");
    expect(pkce.challenge).toBe(expected);
  });
});
