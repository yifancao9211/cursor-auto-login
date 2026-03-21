/**
 * Compute an overall health score (0–100) from account data.
 *
 * Dimensions (weighted):
 *   tokenHealth    (35%) — % of non-disabled accounts with valid tokens
 *   balanceHealth  (30%) — % of active accounts with remaining balance
 *   freshnessHealth(20%) — avg recency of last_checked (100 = <1h, 0 = >24h)
 *   coverageHealth (15%) — % of accounts that are NOT new/pending
 */
export function computeHealthScore(accounts) {
  const scorable = accounts.filter((a) => a.account_status !== "disabled");
  if (scorable.length === 0) {
    return { score: 0, grade: "F", breakdown: { tokenHealth: 0, balanceHealth: 0, freshnessHealth: 0, coverageHealth: 0 } };
  }

  const tokenHealth = Math.round((scorable.filter((a) => a.token_valid).length / scorable.length) * 100);

  const activeWithData = scorable.filter((a) => a.account_status === "active" && (a.plan_limit != null || a.on_demand_limit != null));
  let balanceHealth = 100;
  if (activeWithData.length > 0) {
    const withBalance = activeWithData.filter((a) => {
      const used = (a.plan_used || 0) + (a.on_demand_used || 0);
      const limit = (a.plan_limit || 0) + (a.on_demand_limit || 0);
      return limit > 0 && used < limit;
    });
    balanceHealth = Math.round((withBalance.length / activeWithData.length) * 100);
  }

  const now = Date.now();
  const MAX_STALE_MS = 24 * 60 * 60 * 1000;
  const checked = scorable.filter((a) => a.last_checked);
  let freshnessHealth = 100;
  if (checked.length > 0) {
    const freshnesses = checked.map((a) => {
      const age = now - new Date(a.last_checked).getTime();
      return Math.max(0, Math.round((1 - Math.min(age, MAX_STALE_MS) / MAX_STALE_MS) * 100));
    });
    freshnessHealth = Math.round(freshnesses.reduce((s, v) => s + v, 0) / freshnesses.length);
  }

  const processed = scorable.filter((a) => a.account_status !== "new");
  const coverageHealth = Math.round((processed.length / scorable.length) * 100);

  const score = Math.round(tokenHealth * 0.35 + balanceHealth * 0.3 + freshnessHealth * 0.2 + coverageHealth * 0.15);
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

  return { score, grade, breakdown: { tokenHealth, balanceHealth, freshnessHealth, coverageHealth } };
}
