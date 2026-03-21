import { describe, it, expect } from "vitest";
import { computeHealthScore } from "../ui/utils/health-score.js";

describe("computeHealthScore", () => {
  it("returns 0 with no accounts", () => {
    expect(computeHealthScore([])).toEqual({
      score: 0,
      grade: "F",
      breakdown: { tokenHealth: 0, balanceHealth: 0, freshnessHealth: 0, coverageHealth: 0 },
    });
  });

  it("returns 100 for all-perfect accounts", () => {
    const accounts = [
      makeAccount({ token_valid: 1, account_status: "active", plan_limit: 20, plan_used: 0, on_demand_limit: 5, on_demand_used: 0, last_checked: new Date().toISOString() }),
      makeAccount({ token_valid: 1, account_status: "active", plan_limit: 20, plan_used: 5, on_demand_limit: 5, on_demand_used: 0, last_checked: new Date().toISOString() }),
    ];
    const result = computeHealthScore(accounts);
    expect(result.score).toBe(100);
    expect(result.grade).toBe("A");
  });

  it("penalizes invalid tokens", () => {
    const accounts = [
      makeAccount({ token_valid: 1, account_status: "active", plan_limit: 20, plan_used: 0 }),
      makeAccount({ token_valid: 0, account_status: "failed", plan_limit: 20, plan_used: 0 }),
    ];
    const result = computeHealthScore(accounts);
    expect(result.breakdown.tokenHealth).toBe(50);
    expect(result.score).toBeLessThan(100);
  });

  it("penalizes exhausted balances", () => {
    const accounts = [
      makeAccount({ token_valid: 1, account_status: "active", plan_limit: 20, plan_used: 20, on_demand_limit: 5, on_demand_used: 5 }),
    ];
    const result = computeHealthScore(accounts);
    expect(result.breakdown.balanceHealth).toBe(0);
  });

  it("penalizes stale last_checked", () => {
    const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48h ago
    const accounts = [
      makeAccount({ token_valid: 1, account_status: "active", plan_limit: 20, plan_used: 0, last_checked: staleDate }),
    ];
    const result = computeHealthScore(accounts);
    expect(result.breakdown.freshnessHealth).toBeLessThan(50);
  });

  it("gives correct grade letters", () => {
    expect(computeHealthScore(makeN(10, { token_valid: 1, account_status: "active", plan_limit: 20, plan_used: 2, last_checked: new Date().toISOString() })).grade).toBe("A");
    // All failed → low score (tokenHealth=0, but coverageHealth=100 since "failed" ≠ "new")
    const failed = computeHealthScore(makeN(5, { token_valid: 0, account_status: "failed" }));
    expect(failed.breakdown.tokenHealth).toBe(0);
    expect(failed.score).toBeLessThan(70);
  });

  it("ignores disabled accounts in scoring", () => {
    const accounts = [
      makeAccount({ token_valid: 1, account_status: "active", plan_limit: 20, plan_used: 0, last_checked: new Date().toISOString() }),
      makeAccount({ token_valid: 0, account_status: "disabled" }),
    ];
    const result = computeHealthScore(accounts);
    expect(result.breakdown.tokenHealth).toBe(100);
  });
});

function makeAccount(overrides = {}) {
  return { email: `test-${Math.random().toString(36).slice(2)}@test.com`, token_valid: 0, account_status: "new", ...overrides };
}

function makeN(n, overrides) {
  return Array.from({ length: n }, () => makeAccount(overrides));
}
