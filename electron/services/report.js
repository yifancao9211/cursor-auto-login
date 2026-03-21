const COLUMNS = [
  "email", "status", "token_valid", "membership_type", "plan_used", "plan_limit",
  "on_demand_used", "on_demand_limit", "balance", "org_name", "team_role", "last_checked",
];

export function generateReportData(accounts) {
  return accounts.map((a) => {
    const planUsed = a.plan_used || 0;
    const planLimit = a.plan_limit || 0;
    const odUsed = a.on_demand_used || 0;
    const odLimit = a.on_demand_limit || 0;
    const balance = +((planLimit + odLimit) - (planUsed + odUsed)).toFixed(2);
    return {
      email: a.email,
      status: a.account_status || "unknown",
      token_valid: a.token_valid ? "Yes" : "No",
      membership_type: a.membership_type || "",
      plan_used: planUsed,
      plan_limit: planLimit,
      on_demand_used: odUsed,
      on_demand_limit: odLimit,
      balance: Math.max(0, balance),
      org_name: a.org_name || "",
      team_role: a.team_role || "",
      last_checked: a.last_checked || "",
    };
  });
}

function escapeCSV(val) {
  const str = String(val ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateCSV(accounts) {
  const rows = generateReportData(accounts);
  const header = COLUMNS.join(",");
  if (rows.length === 0) return header;
  const body = rows.map((row) => COLUMNS.map((col) => escapeCSV(row[col])).join(",")).join("\n");
  return `${header}\n${body}`;
}
