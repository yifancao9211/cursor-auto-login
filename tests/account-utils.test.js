import { describe, it, expect } from "vitest";
import { getBalance, parseJwt, usageBarColor, buildSwitchPayload } from "../ui/utils/account.js";

describe("getBalance", () => {
  it("computes correct balance for active account", () => {
    const result = getBalance({ plan_used: 5, plan_limit: 20, on_demand_used: 1, on_demand_limit: 5 });
    expect(result.totalUsed).toBe(6);
    expect(result.totalLimit).toBe(25);
    expect(result.balance).toBe(19);
    expect(result.hasBalance).toBe(true);
    expect(result.hasData).toBe(true);
    expect(result.usagePercent).toBe(24);
  });

  it("returns hasBalance=false when fully exhausted", () => {
    const result = getBalance({ plan_used: 20, plan_limit: 20, on_demand_used: 5, on_demand_limit: 5 });
    expect(result.balance).toBe(0);
    expect(result.hasBalance).toBe(false);
  });

  it("returns hasData=false when no limits set", () => {
    const result = getBalance({});
    expect(result.hasData).toBe(false);
    expect(result.balance).toBeNull();
  });

  it("handles only plan data (no on_demand)", () => {
    const result = getBalance({ plan_used: 3, plan_limit: 20 });
    expect(result.totalUsed).toBe(3);
    expect(result.totalLimit).toBe(20);
    expect(result.hasData).toBe(true);
    expect(result.balance).toBe(17);
  });

  it("handles only on_demand data (no plan)", () => {
    const result = getBalance({ on_demand_used: 2, on_demand_limit: 10 });
    expect(result.totalUsed).toBe(2);
    expect(result.totalLimit).toBe(10);
    expect(result.balance).toBe(8);
  });

  it("caps usagePercent at 100", () => {
    const result = getBalance({ plan_used: 30, plan_limit: 20 });
    expect(result.usagePercent).toBe(100);
  });

  it("returns usagePercent 0 when limit is 0", () => {
    const result = getBalance({ plan_used: 0, plan_limit: 0 });
    expect(result.usagePercent).toBe(0);
  });
});

describe("parseJwt", () => {
  it("returns null for null/empty", () => {
    expect(parseJwt(null)).toBeNull();
    expect(parseJwt("")).toBeNull();
    expect(parseJwt(undefined)).toBeNull();
  });

  it("parses a valid JWT payload", () => {
    const payload = { sub: "user123", type: "session", exp: 1700000000 };
    const b64 = btoa(JSON.stringify(payload));
    const jwt = `header.${b64}.signature`;
    const result = parseJwt(jwt);
    expect(result.sub).toBe("user123");
    expect(result.type).toBe("session");
    expect(result.exp).toBe(1700000000);
  });

  it("handles base64url encoding (- and _)", () => {
    const payload = { data: "test+value/here" };
    const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    const jwt = `h.${b64}.s`;
    const result = parseJwt(jwt);
    expect(result.data).toBe("test+value/here");
  });

  it("returns null for malformed JWT", () => {
    expect(parseJwt("not-a-jwt")).toBeNull();
    expect(parseJwt("a.!!!invalid-base64.b")).toBeNull();
  });
});

describe("usageBarColor", () => {
  it("returns danger for >90%", () => {
    expect(usageBarColor(95)).toContain("danger");
  });

  it("returns warning for 71-90%", () => {
    expect(usageBarColor(80)).toContain("warning");
  });

  it("returns success for ≤70%", () => {
    expect(usageBarColor(50)).toContain("success");
    expect(usageBarColor(0)).toContain("success");
    expect(usageBarColor(70)).toContain("success");
  });
});

describe("buildSwitchPayload", () => {
  it("extracts only the required fields", () => {
    const acc = {
      email: "test@t.com",
      token: "tok123",
      access_token: "at456",
      refresh_token: "rt789",
      membership_type: "pro",
      stripe_customer_id: "cus_abc",
      team_id: "team1",
      plan_used: 5,
      plan_limit: 20,
      machine_id: "mid",
      extra_field: "should_not_appear",
    };
    const result = buildSwitchPayload(acc);
    expect(result).toEqual({
      email: "test@t.com",
      token: "tok123",
      access_token: "at456",
      refresh_token: "rt789",
      membership_type: "pro",
      stripe_customer_id: "cus_abc",
      team_id: "team1",
    });
    expect(result).not.toHaveProperty("plan_used");
    expect(result).not.toHaveProperty("extra_field");
  });

  it("handles missing optional fields", () => {
    const result = buildSwitchPayload({ email: "a@b.com" });
    expect(result.email).toBe("a@b.com");
    expect(result.token).toBeUndefined();
  });
});
