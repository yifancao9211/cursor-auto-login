import { describe, it, expect } from "vitest";
import { aggregateSnapshots, buildTrendData } from "../electron/services/usage-history.js";

describe("aggregateSnapshots", () => {
  it("aggregates daily totals from account snapshots", () => {
    const snapshots = [
      { date: "2025-01-01", email: "a@t.com", plan_used: 5, on_demand_used: 1, plan_limit: 20, on_demand_limit: 5 },
      { date: "2025-01-01", email: "b@t.com", plan_used: 10, on_demand_used: 2, plan_limit: 20, on_demand_limit: 5 },
      { date: "2025-01-02", email: "a@t.com", plan_used: 8, on_demand_used: 1, plan_limit: 20, on_demand_limit: 5 },
    ];
    const result = aggregateSnapshots(snapshots);
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe("2025-01-01");
    expect(result[0].totalUsed).toBe(18);
    expect(result[0].totalLimit).toBe(50);
    expect(result[0].accountCount).toBe(2);
    expect(result[1].accountCount).toBe(1);
  });

  it("handles empty input", () => {
    expect(aggregateSnapshots([])).toEqual([]);
  });
});

describe("buildTrendData", () => {
  it("fills missing dates with zero values", () => {
    const aggregated = [
      { date: "2025-01-01", totalUsed: 10, totalLimit: 50, accountCount: 2 },
      { date: "2025-01-03", totalUsed: 15, totalLimit: 50, accountCount: 2 },
    ];
    const result = buildTrendData(aggregated, 3);
    expect(result).toHaveLength(3);
    expect(result[1].date).toBe("2025-01-02");
    expect(result[1].totalUsed).toBe(0);
  });

  it("limits to requested days", () => {
    const aggregated = Array.from({ length: 30 }, (_, i) => ({
      date: `2025-01-${String(i + 1).padStart(2, "0")}`,
      totalUsed: i * 5,
      totalLimit: 100,
      accountCount: 5,
    }));
    const result = buildTrendData(aggregated, 7);
    expect(result).toHaveLength(7);
  });
});
