import { describe, it, expect } from "vitest";
import { generateCSV, generateReportData } from "../electron/services/report.js";

describe("generateReportData", () => {
  it("produces rows with all required columns", () => {
    const accounts = [
      { email: "a@t.com", account_status: "active", token_valid: 1, plan_used: 5, plan_limit: 20, on_demand_used: 1, on_demand_limit: 5, membership_type: "pro", last_checked: "2025-01-01T00:00:00Z", org_name: "Team" },
      { email: "b@t.com", account_status: "failed", token_valid: 0 },
    ];
    const rows = generateReportData(accounts);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveProperty("email", "a@t.com");
    expect(rows[0]).toHaveProperty("balance", 19);
    expect(rows[0]).toHaveProperty("status", "active");
    expect(rows[1]).toHaveProperty("balance", 0);
  });
});

describe("generateCSV", () => {
  it("produces valid CSV with headers", () => {
    const accounts = [
      { email: "a@t.com", account_status: "active", token_valid: 1, plan_used: 5, plan_limit: 20, on_demand_used: 0, on_demand_limit: 0, membership_type: "pro", last_checked: "2025-01-01T00:00:00Z" },
    ];
    const csv = generateCSV(accounts);
    const lines = csv.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("email");
    expect(lines[0]).toContain("balance");
    expect(lines[1]).toContain("a@t.com");
  });

  it("escapes commas and quotes in values", () => {
    const accounts = [
      { email: 'a"b@t.com', account_status: "active", token_valid: 1, org_name: "Team, Inc." },
    ];
    const csv = generateCSV(accounts);
    expect(csv).toContain('"a""b@t.com"');
    expect(csv).toContain('"Team, Inc."');
  });

  it("handles empty accounts", () => {
    const csv = generateCSV([]);
    const lines = csv.trim().split("\n");
    expect(lines.length).toBe(1);
  });
});
