/**
 * Usage history aggregation for trend charts.
 * Snapshots are recorded per-account per-day; this module aggregates them.
 */

export function aggregateSnapshots(snapshots) {
  const byDate = new Map();
  for (const s of snapshots) {
    if (!byDate.has(s.date)) {
      byDate.set(s.date, { date: s.date, totalUsed: 0, totalLimit: 0, accountCount: 0 });
    }
    const day = byDate.get(s.date);
    day.totalUsed += (s.plan_used || 0) + (s.on_demand_used || 0);
    day.totalLimit += (s.plan_limit || 0) + (s.on_demand_limit || 0);
    day.accountCount++;
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function buildTrendData(aggregated, days) {
  if (aggregated.length === 0) return [];

  const byDate = new Map(aggregated.map((d) => [d.date, d]));
  const allDates = [...byDate.keys()].sort();
  const lastDate = allDates[allDates.length - 1];

  const result = [];
  const end = new Date(lastDate);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    result.push(byDate.get(dateStr) || { date: dateStr, totalUsed: 0, totalLimit: 0, accountCount: 0 });
  }
  return result;
}

// SQL schema and upsert are handled directly in account-db.js init()
