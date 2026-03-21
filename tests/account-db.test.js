import { describe, it, expect } from "vitest";

/**
 * Test the pure logic of account-db without native SQLite dependency.
 * We replicate the ALLOWED_COLUMNS whitelist and upsert filtering logic.
 */

const ALLOWED_COLUMNS = new Set([
  "email", "token", "access_token", "refresh_token", "membership_type",
  "days_remaining", "on_demand_used", "on_demand_limit", "plan_used", "plan_limit",
  "reset_date", "token_valid", "last_checked", "created_at", "account_status",
  "org_name", "org_id", "machine_id", "mac_machine_id", "dev_device_id", "sqm_id",
  "stripe_customer_id", "team_id", "is_admin", "team_role", "tags",
]);

function filterFieldsForUpdate(account) {
  return Object.keys(account).filter(k => k !== "email" && account[k] !== undefined && ALLOWED_COLUMNS.has(k));
}

function filterFieldsForInsert(account) {
  return Object.keys(account).filter(k => account[k] !== undefined && ALLOWED_COLUMNS.has(k));
}

describe("ALLOWED_COLUMNS whitelist", () => {
  it("contains all expected columns", () => {
    expect(ALLOWED_COLUMNS.has("email")).toBe(true);
    expect(ALLOWED_COLUMNS.has("token")).toBe(true);
    expect(ALLOWED_COLUMNS.has("access_token")).toBe(true);
    expect(ALLOWED_COLUMNS.has("tags")).toBe(true);
    expect(ALLOWED_COLUMNS.has("account_status")).toBe(true);
  });

  it("rejects unknown columns", () => {
    expect(ALLOWED_COLUMNS.has("malicious_col")).toBe(false);
    expect(ALLOWED_COLUMNS.has("'; DROP TABLE accounts; --")).toBe(false);
    expect(ALLOWED_COLUMNS.has("__proto__")).toBe(false);
    expect(ALLOWED_COLUMNS.has("constructor")).toBe(false);
  });
});

describe("upsert field filtering", () => {
  it("filters update fields by whitelist", () => {
    const account = { email: "a@t.com", token: "tok1", evil_field: "hack", "DROP TABLE": "lol" };
    const fields = filterFieldsForUpdate(account);
    expect(fields).toEqual(["token"]);
    expect(fields).not.toContain("evil_field");
    expect(fields).not.toContain("DROP TABLE");
    expect(fields).not.toContain("email");
  });

  it("excludes undefined values", () => {
    const account = { email: "a@t.com", token: "tok1", plan_used: undefined, plan_limit: 20 };
    const fields = filterFieldsForUpdate(account);
    expect(fields).toContain("token");
    expect(fields).toContain("plan_limit");
    expect(fields).not.toContain("plan_used");
  });

  it("returns empty array when only email is present", () => {
    const fields = filterFieldsForUpdate({ email: "a@t.com" });
    expect(fields).toEqual([]);
  });

  it("includes email for insert but not for update", () => {
    const account = { email: "a@t.com", token: "tok1" };
    expect(filterFieldsForInsert(account)).toContain("email");
    expect(filterFieldsForUpdate(account)).not.toContain("email");
  });

  it("handles all valid columns", () => {
    const account = {};
    for (const col of ALLOWED_COLUMNS) account[col] = "test_value";
    const insertFields = filterFieldsForInsert(account);
    expect(insertFields.length).toBe(ALLOWED_COLUMNS.size);
    const updateFields = filterFieldsForUpdate(account);
    expect(updateFields.length).toBe(ALLOWED_COLUMNS.size - 1); // minus email
  });
});

describe("SQL injection prevention", () => {
  it("malicious key names are filtered out before SQL construction", () => {
    const maliciousAccount = {
      email: "victim@t.com",
      "token = 'hacked' WHERE 1=1; --": "injected",
      "'; DROP TABLE accounts; --": "injected",
      token: "legitimate_token",
    };
    const fields = filterFieldsForUpdate(maliciousAccount);
    expect(fields).toEqual(["token"]);
    const sets = fields.map(f => `${f} = @${f}`).join(", ");
    expect(sets).toBe("token = @token");
    expect(sets).not.toContain("DROP");
    expect(sets).not.toContain("hacked");
  });

  it("prototype pollution keys are blocked", () => {
    const account = {
      email: "a@t.com",
      __proto__: { admin: true },
      constructor: "evil",
      prototype: "evil",
    };
    const fields = filterFieldsForUpdate(account);
    expect(fields).not.toContain("__proto__");
    expect(fields).not.toContain("constructor");
    expect(fields).not.toContain("prototype");
  });
});

describe("tags parsing (pure logic)", () => {
  function getAllTagsFromRows(rows) {
    const tagSet = new Set();
    for (const r of rows) {
      if (!r.tags) continue;
      for (const t of r.tags.split(",")) {
        const trimmed = t.trim().toLowerCase();
        if (trimmed) tagSet.add(trimmed);
      }
    }
    return [...tagSet].sort();
  }

  it("aggregates and deduplicates tags", () => {
    const rows = [
      { tags: "dev,prod" },
      { tags: "dev,staging" },
      { tags: "Dev, PROD" },
    ];
    expect(getAllTagsFromRows(rows)).toEqual(["dev", "prod", "staging"]);
  });

  it("handles empty/null tags", () => {
    const rows = [{ tags: "" }, { tags: null }];
    expect(getAllTagsFromRows(rows)).toEqual([]);
  });
});
