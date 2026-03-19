import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";

function getCursorDataDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Cursor");
  } else if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Cursor");
  } else {
    return path.join(os.homedir(), ".config", "Cursor");
  }
}

const STATE_DB_PATH = path.join(
  getCursorDataDir(),
  "User",
  "globalStorage",
  "state.vscdb"
);

// Cursor 从 state.vscdb 读取的全部 auth 相关 key
const AUTH_KEYS = {
  accessToken: "cursorAuth/accessToken",
  refreshToken: "cursorAuth/refreshToken",
  cachedEmail: "cursorAuth/cachedEmail",
  cachedSignUpType: "cursorAuth/cachedSignUpType",
  stripeMembershipType: "cursorAuth/stripeMembershipType",
  stripeSubscriptionStatus: "cursorAuth/stripeSubscriptionStatus",
  stripeCustomerId: "cursorAuth/stripeCustomerId",
  teamId: "cursorAuth/teamId",
  browser: "cursorAuth/browser",
};

function openDb() {
  return new Database(STATE_DB_PATH);
}

export const cursorDb = {
  readAuth() {
    try {
      const db = openDb();
      const stmt = db.prepare("SELECT key, value FROM ItemTable WHERE key LIKE 'cursorAuth/%'");
      const rows = stmt.all();
      db.close();

      const result = {};
      for (const row of rows) {
        const shortKey = row.key.replace("cursorAuth/", "");
        result[shortKey] = row.value;
      }
      return result;
    } catch (e) {
      return { error: e.message };
    }
  },

  writeAuth({ accessToken, refreshToken, email, signUpType, membershipType, stripeCustomerId, teamId }) {
    try {
      const db = openDb();
      const stmt = db.prepare("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)");
      const tx = db.transaction(() => {
        if (accessToken) stmt.run(AUTH_KEYS.accessToken, accessToken);
        if (refreshToken) stmt.run(AUTH_KEYS.refreshToken, refreshToken);
        if (email) stmt.run(AUTH_KEYS.cachedEmail, email);
        // Cursor 需要这些字段来正确显示用户信息
        stmt.run(AUTH_KEYS.cachedSignUpType, signUpType || "Auth_0");
        stmt.run(AUTH_KEYS.stripeMembershipType, membershipType || "free");
        stmt.run(AUTH_KEYS.stripeSubscriptionStatus, "active");
        // 以下字段对 Cursor 显示用户信息至关重要
        if (stripeCustomerId) stmt.run(AUTH_KEYS.stripeCustomerId, stripeCustomerId);
        if (teamId) stmt.run(AUTH_KEYS.teamId, teamId);
        // browser 标识：让 Cursor 认为是通过浏览器认证的
        stmt.run(AUTH_KEYS.browser, "true");
      });
      tx();
      db.close();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
};
