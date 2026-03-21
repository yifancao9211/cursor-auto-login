/**
 * Shared account utility functions to eliminate duplication across views.
 */

export function getBalance(account) {
  const totalUsed = (account.plan_used || 0) + (account.on_demand_used || 0);
  const totalLimit = (account.plan_limit || 0) + (account.on_demand_limit || 0);
  const hasData = account.on_demand_limit != null || account.plan_limit != null;
  const hasBalance = hasData && totalUsed < totalLimit;
  const balance = hasData ? +(totalLimit - totalUsed).toFixed(2) : null;
  const usagePercent = totalLimit > 0 ? Math.min(100, (totalUsed / totalLimit) * 100) : 0;
  return { totalUsed: +totalUsed.toFixed(2), totalLimit: +totalLimit.toFixed(2), hasData, hasBalance, balance, usagePercent };
}

export function parseJwt(token) {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export function usageBarColor(pct) {
  if (pct > 90) return "bg-apple-danger shadow-[0_0_8px_rgba(255,59,48,0.5)]";
  if (pct > 70) return "bg-apple-warning shadow-[0_0_8px_rgba(255,149,0,0.5)]";
  return "bg-apple-success shadow-[0_0_8px_rgba(52,199,89,0.5)]";
}

export function buildSwitchPayload(acc) {
  return {
    email: acc.email,
    token: acc.token,
    access_token: acc.access_token,
    refresh_token: acc.refresh_token,
    membership_type: acc.membership_type,
    stripe_customer_id: acc.stripe_customer_id,
    team_id: acc.team_id,
  };
}
