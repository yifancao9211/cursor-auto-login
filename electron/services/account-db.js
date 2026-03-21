import path from "node:path";
import { app } from "electron";
import Database from "better-sqlite3";

let db;

const ALLOWED_COLUMNS = new Set([
  "email", "token", "access_token", "refresh_token", "membership_type",
  "days_remaining", "on_demand_used", "on_demand_limit", "plan_used", "plan_limit",
  "reset_date", "token_valid", "last_checked", "created_at", "account_status",
  "org_name", "org_id", "machine_id", "mac_machine_id", "dev_device_id", "sqm_id",
  "stripe_customer_id", "team_id", "is_admin", "team_role",
]);

function getDbPath() {
  return path.join(app.getPath("userData"), "accounts.db");
}

export const accountDb = {
  init() {
    db = new Database(getDbPath());
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        email TEXT PRIMARY KEY,
        token TEXT,
        access_token TEXT,
        refresh_token TEXT,
        membership_type TEXT,
        days_remaining INTEGER DEFAULT 0,
        on_demand_used REAL,
        on_demand_limit REAL,
        plan_used REAL,
        plan_limit REAL,
        reset_date TEXT,
        token_valid INTEGER DEFAULT 1,
        last_checked TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        account_status TEXT DEFAULT 'new',
        org_name TEXT,
        org_id TEXT
      )
    `);
    // 兼容旧表：添加新列
    const addCol = (col, type) => {
      try { db.exec(`ALTER TABLE accounts ADD COLUMN ${col} ${type}`); } catch { /* already exists */ }
    };
    addCol("access_token", "TEXT");
    addCol("refresh_token", "TEXT");
    addCol("machine_id", "TEXT");
    addCol("mac_machine_id", "TEXT");
    addCol("dev_device_id", "TEXT");
    addCol("sqm_id", "TEXT");
    addCol("account_status", "TEXT DEFAULT 'new'");
    addCol("org_name", "TEXT");
    addCol("org_id", "TEXT");
    addCol("stripe_customer_id", "TEXT");
    addCol("team_id", "TEXT");
    addCol("is_admin", "INTEGER DEFAULT 0");
    addCol("team_role", "TEXT");

    // 把旧的没有 account_status 的记录，根据 token_valid 推断状态
    db.exec(`UPDATE accounts SET account_status = 'active' WHERE account_status IS NULL AND token_valid = 1 AND token IS NOT NULL`);
    db.exec(`UPDATE accounts SET account_status = 'failed' WHERE account_status IS NULL AND token_valid = 0`);
    db.exec(`UPDATE accounts SET account_status = 'new' WHERE account_status IS NULL`);
  },

  listAll() {
    return db.prepare("SELECT * FROM accounts ORDER BY created_at DESC").all();
  },

  listByStatus(status) {
    return db.prepare("SELECT * FROM accounts WHERE account_status = ? ORDER BY created_at DESC").all(status);
  },

  listActive() { return this.listByStatus("active"); },
  listNew() { return this.listByStatus("new"); },
  listFailed() { return this.listByStatus("failed"); },

  /** 返回有效的管理员账号 (is_admin=1 且 token_valid=1 且有 token) */
  listAdmins() {
    return db.prepare(
      "SELECT * FROM accounts WHERE is_admin = 1 AND token_valid = 1 AND (token IS NOT NULL OR access_token IS NOT NULL) ORDER BY created_at DESC"
    ).all();
  },

  /** 返回 team_role 未判定且有有效 token 的账号 */
  listUncheckedRole() {
    return db.prepare(
      "SELECT * FROM accounts WHERE team_role IS NULL AND token_valid = 1 AND (token IS NOT NULL OR access_token IS NOT NULL) ORDER BY created_at DESC"
    ).all();
  },

  upsert(account) {
    const existing = db.prepare("SELECT email FROM accounts WHERE email = ?").get(account.email);
    if (existing) {
      const fields = Object.keys(account).filter((k) => k !== "email" && account[k] !== undefined && ALLOWED_COLUMNS.has(k));
      if (fields.length === 0) return;
      const sets = fields.map((f) => `${f} = @${f}`).join(", ");
      db.prepare(`UPDATE accounts SET ${sets} WHERE email = @email`).run(account);
    } else {
      const fields = Object.keys(account).filter((k) => account[k] !== undefined && ALLOWED_COLUMNS.has(k));
      const cols = fields.join(", ");
      const vals = fields.map((f) => `@${f}`).join(", ");
      db.prepare(`INSERT INTO accounts (${cols}) VALUES (${vals})`).run(account);
    }
  },

  remove(emails) {
    const placeholders = emails.map(() => "?").join(",");
    return db.prepare(`DELETE FROM accounts WHERE email IN (${placeholders})`).run(...emails).changes;
  },

  /** 检查邮箱是否已存在 */
  exists(email) {
    return !!db.prepare("SELECT 1 FROM accounts WHERE email = ?").get(email);
  },

  importFromTokensJson(data) {
    const tx = db.transaction(() => {
      let count = 0;
      for (const [email, token] of Object.entries(data)) {
        const existing = db.prepare("SELECT email FROM accounts WHERE email = ?").get(email);
        if (existing) {
          db.prepare("UPDATE accounts SET token = ? WHERE email = ?").run(token, email);
        } else {
          // 新导入的标记为 'new'
          db.prepare("INSERT INTO accounts (email, token, account_status) VALUES (?, ?, 'new')").run(email, token);
        }
        count++;
      }
      return count;
    });
    return tx();
  },

  exportToTokensJson() {
    const rows = db.prepare("SELECT email, token FROM accounts WHERE token IS NOT NULL").all();
    const result = {};
    for (const row of rows) {
      result[row.email] = row.token;
    }
    return result;
  },

  getAccountsWithBalance() {
    return db
      .prepare(
        `SELECT * FROM accounts
         WHERE token_valid = 1 AND account_status = 'active'
           AND (COALESCE(plan_limit, 0) + COALESCE(on_demand_limit, 0)) > 0
           AND (COALESCE(plan_used, 0) + COALESCE(on_demand_used, 0)) < (COALESCE(plan_limit, 0) + COALESCE(on_demand_limit, 0))
         ORDER BY (COALESCE(plan_used, 0) + COALESCE(on_demand_used, 0)) ASC`
      )
      .all();
  },

  // -- 机器码相关方法 --

  getMachineIds(email) {
    const row = db
      .prepare("SELECT machine_id, mac_machine_id, dev_device_id, sqm_id FROM accounts WHERE email = ?")
      .get(email);
    if (!row || !row.machine_id) return null;
    return {
      machineId: row.machine_id,
      macMachineId: row.mac_machine_id,
      devDeviceId: row.dev_device_id,
      sqmId: row.sqm_id || "",
    };
  },

  saveMachineIds(email, ids) {
    db.prepare(
      `UPDATE accounts SET machine_id = ?, mac_machine_id = ?, dev_device_id = ?, sqm_id = ? WHERE email = ?`
    ).run(ids.machineId, ids.macMachineId, ids.devDeviceId, ids.sqmId || "", email);
  },
};
