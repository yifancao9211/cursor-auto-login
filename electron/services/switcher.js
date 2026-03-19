import { exec } from "node:child_process";
import { promisify } from "node:util";
import { cursorDb } from "./cursor-db.js";
import { machineIdService } from "./machine-id.js";

const execAsync = promisify(exec);

function extractJwt(token) {
  if (!token) return null;
  const decoded = decodeURIComponent(token);
  const parts = decoded.split("::");
  return parts.length >= 2 ? parts[1] : parts[0];
}

async function killCursor() {
  try {
    if (process.platform === "darwin") {
      await execAsync('osascript -e \'quit app "Cursor"\'').catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
      await execAsync("pkill -f 'Cursor' || true");
    } else if (process.platform === "win32") {
      await execAsync("taskkill /F /IM Cursor.exe /T").catch(() => {});
    } else {
      await execAsync("pkill -f cursor || true");
    }
    await new Promise((r) => setTimeout(r, 2000));
  } catch {
    // Cursor may not be running
  }
}

async function launchCursor() {
  try {
    if (process.platform === "darwin") {
      await execAsync('open -a "Cursor"');
    } else if (process.platform === "win32") {
      await execAsync('start "" "Cursor"');
    }
  } catch {
    // Best effort
  }
}

export const switcher = {
  async switchAccount(account, { resetMachineId = true, accountDb = null } = {}) {
    const { email, token, access_token, refresh_token, membership_type, stripe_customer_id, team_id } = account;

    // 优先使用 access_token (type: "session")，否则从 web cookie 提取 JWT
    let accessToken = access_token;
    let refreshToken = refresh_token || access_token;

    if (!accessToken) {
      const jwt = extractJwt(token);
      if (!jwt) return { success: false, error: "无可用 token" };
      accessToken = jwt;
      refreshToken = jwt;
    }

    await killCursor();

    // -- 机器码切换 --
    let machineIdResult = null;
    if (resetMachineId && accountDb) {
      try {
        // 首次使用时备份原始机器码
        machineIdService.backupOriginal();

        // 查询账号绑定的机器码
        let ids = accountDb.getMachineIds(email);
        if (!ids) {
          // 没有绑定 → 生成新的并保存
          const currentIds = machineIdService.readCurrent() || {};
          ids = machineIdService.generate(currentIds);
          accountDb.saveMachineIds(email, ids);
          console.log(`[switcher] Generated new machine IDs for ${email}`);
        } else {
          console.log(`[switcher] Restoring saved machine IDs for ${email}`);
        }

        // 写入 storage.json
        machineIdResult = machineIdService.writeTo(ids);
      } catch (e) {
        console.error("[switcher] Machine ID switch failed:", e.message);
        machineIdResult = { success: false, error: e.message };
      }
    }

    const result = cursorDb.writeAuth({
      accessToken,
      refreshToken,
      email,
      signUpType: "Auth_0",
      membershipType: membership_type || "free",
      stripeCustomerId: stripe_customer_id || undefined,
      teamId: team_id || undefined,
    });
    if (!result.success) {
      return { success: false, error: result.error };
    }

    await launchCursor();
    return {
      success: true,
      email,
      tokenType: access_token ? "session" : "web",
      machineIdReset: machineIdResult,
    };
  },

  async smartSwitch(accountDb, cursorApi) {
    const currentAuth = cursorDb.readAuth();
    const currentEmail = currentAuth.cachedEmail;

    if (currentEmail) {
      const currentAcc = accountDb.listAll().find((a) => a.email === currentEmail);
      if (currentAcc?.access_token || currentAcc?.token) {
        const usage = await cursorApi.fetchUsageSmart(currentAcc);
        if (usage.status === 200 && usage.data) {
          const plan = usage.data.individualUsage?.plan;
          const od = usage.data.individualUsage?.onDemand;
          const totalUsed = (plan?.used || 0) + (od?.used || 0);
          const totalLimit = (plan?.limit || 0) + (od?.limit || 0);
          if (totalUsed < totalLimit) {
            return { success: false, reason: "current_has_balance", email: currentEmail };
          }
        }
      }
    }

    const candidates = accountDb.getAccountsWithBalance();
    const next = candidates.find((a) => a.email !== currentEmail);
    if (!next) {
      return { success: false, reason: "no_accounts_with_balance" };
    }

    return this.switchAccount(next, { resetMachineId: true, accountDb });
  },
};
