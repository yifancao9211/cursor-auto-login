import { app, BrowserWindow, ipcMain, dialog, shell, powerSaveBlocker } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { cursorDb } from "./services/cursor-db.js";
import { cursorApi } from "./services/cursor-api.js";
import { accountDb } from "./services/account-db.js";
import { switcher } from "./services/switcher.js";
import { loginService } from "./services/login.js";
import { machineIdService } from "./services/machine-id.js";
import { tokenExchange } from "./services/token-exchange.js";
import { logger } from "./services/logger.js";
import { hasValidCredentials } from "./services/auth-utils.js";
import { trayService } from "./services/tray.js";
import { dispatchWebhook, WEBHOOK_EVENTS, feishuListChats } from "./services/webhook.js";
import { generateCSV } from "./services/report.js";
import { initUpdater, checkForUpdates, quitAndInstall } from "./services/updater.js";

const DEFAULT_PASSWORD = "abcd@1234";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow;
let autoCheckTimer = null;
let autoCheckIntervalMs = 30 * 60 * 1000; // 默认 30 分钟
let autoCheckRunning = false;
let lastAutoCheckTime = null;
let orgDiscoveryEnabled = true;
let retryFailedEnabled = false;
let retryFailedTime = "00:00";
let retryFailedTimer = null;
let trayHandle = null;

function createWindow() {
  const windowConfig = {
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: "Cursor Account Manager",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  };

  // macOS: hidden inset title bar with traffic lights
  if (process.platform === "darwin") {
    windowConfig.titleBarStyle = "hiddenInset";
    windowConfig.trafficLightPosition = { x: 12, y: 12 };
  } else {
    // Windows/Linux: use default frame with hidden menu bar
    windowConfig.autoHideMenuBar = true;
  }

  mainWindow = new BrowserWindow(windowConfig);

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist-renderer/index.html"));
  }
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  accountDb.init();
  registerIpcHandlers();
  createWindow();
  powerSaveBlocker.start("prevent-app-suspension");
  logger.init(sendToRenderer);

  // System tray
  trayHandle = trayService.init(mainWindow, {
    accountDb,
    onSmartSwitch: () => switcher.smartSwitch(accountDb, cursorApi),
    onRefresh: () => runQuickRefresh(),
    onSwitchAccount: (account) => switcher.switchAccount(account, { resetMachineId: true, accountDb }),
  });

  // Auto-import current Cursor IDE account if not in DB
  (async () => {
    try {
      const auth = cursorDb.readAuth();
      if (auth.cachedEmail && !auth.error) {
        let email = auth.cachedEmail;

        // 如果 cachedEmail 是 auth0 格式，用 cookie 调 /api/auth/me 获取真实邮箱
        if (!email.includes("@")) {
          try {
            // 从 Cursor IDE 的 accessToken 构造 cookie
            let cookie = null;
            if (auth.accessToken) {
              const segs = auth.accessToken.split(".");
              if (segs.length >= 2) {
                let b64 = segs[1].replace(/-/g, "+").replace(/_/g, "/");
                while (b64.length % 4) b64 += "=";
                const payload = JSON.parse(Buffer.from(b64, "base64").toString());
                if (payload.sub) {
                  const userId = payload.sub.split("|").pop();
                  cookie = encodeURIComponent(`${userId}::${auth.accessToken}`);
                }
              }
            }
            if (cookie) {
              const meResp = await cursorApi.fetchAuthMe(cookie);
              if (meResp.status === 200 && meResp.data && meResp.data.email) {
                console.log(`[auto-import] 解析 auth0 ID ${email} 为真实邮箱: ${meResp.data.email}`);
                email = meResp.data.email;
              }
            }
          } catch (e) {
            console.log(`[auto-import] 无法解析 auth0 邮箱: ${e.message}`);
          }
        }

        if (!accountDb.exists(email)) {
          const importData = { email, account_status: "active", token_valid: 1 };
          if (auth.accessToken) importData.access_token = auth.accessToken;
          if (auth.refreshToken) importData.refresh_token = auth.refreshToken;
          accountDb.upsert(importData);
          console.log(`[auto-import] Current IDE account ${email} imported to DB`);
        }
      }
    } catch (e) {
      console.error("[auto-import] Failed:", e.message);
    }
  })();

  // Init auto updater
  initUpdater((event, data) => sendToRenderer("updater:event", { event, data }));
  setTimeout(() => {
    checkForUpdates().catch(e => console.error("[updater] init check failed:", e.message || e));
  }, 15000);

  setTimeout(() => runAutoCheck(), 10000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Keep running in tray on macOS; quit on other platforms
  if (process.platform !== "darwin") {
    if (mainWindow) mainWindow = null;
  }
});


let _cachedWebhookSettings = {};

function setWebhookSettings(settings) {
  _cachedWebhookSettings = {
    webhookEnabled: settings.webhookEnabled || false,
    webhookUrl: settings.webhookUrl || "",
    webhookType: settings.webhookType || "discord",
    feishuAppId: settings.feishuAppId || "",
    feishuAppSecret: settings.feishuAppSecret || "",
    feishuChatId: settings.feishuChatId || "",
  };
}

function getWebhookSettings() {
  return _cachedWebhookSettings;
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ========== 自动巡检 ==========

function startAutoCheck() {
  stopAutoCheck();
  autoCheckTimer = setInterval(() => runAutoCheck(), autoCheckIntervalMs);
  console.log(`[auto-check] Started with interval ${autoCheckIntervalMs / 60000} min`);
}

function stopAutoCheck() {
  if (autoCheckTimer) {
    clearInterval(autoCheckTimer);
    autoCheckTimer = null;
  }
}

// ========== 管理员角色检测 & 团队花费批量更新 ==========

/**
 * 检测单个账号的团队角色，标记管理员
 * @returns {boolean} 是否为管理员
 */
async function detectAdminRole(acc) {
  if (!acc.token && !acc.access_token) return false;

  try {
    // 优先 cookie 调 fetchTeams
    const teamsResp = acc.token
      ? await cursorApi.fetchTeams(acc.token)
      : null;

    if (!teamsResp || teamsResp.status !== 200 || !teamsResp.data) {
      // 如果 cookie 不行，标记为已检查但不是管理员
      accountDb.upsert({ email: acc.email, team_role: "unknown", is_admin: 0 });
      return false;
    }

    const teams = teamsResp.data.teams || (Array.isArray(teamsResp.data) ? teamsResp.data : []);
    let isAdmin = false;
    let teamRole = "TEAM_ROLE_MEMBER";

    for (const team of teams) {
      const role = team.role || "";
      if (role === "TEAM_ROLE_OWNER") {
        isAdmin = true;
        teamRole = "TEAM_ROLE_OWNER";
      }
      // 同时更新 team_id 和 org_name
      accountDb.upsert({
        email: acc.email,
        team_id: String(team.id || team.teamId || ""),
        org_name: team.name || "",
        team_role: teamRole,
        is_admin: isAdmin ? 1 : 0,
      });
    }

    if (teams.length === 0) {
      accountDb.upsert({ email: acc.email, team_role: "none", is_admin: 0 });
    }

    console.log(`[admin-detect] ${acc.email}: role=${teamRole}, isAdmin=${isAdmin}`);
    return isAdmin;
  } catch (e) {
    console.error(`[admin-detect] ${acc.email}: error: ${e.message}`);
    return false;
  }
}

/**
 * 找到可用的管理员账号（DB 有缓存则用缓存，否则扫描所有未判定账号）
 * @returns {object|null} 管理员账号对象
 */
async function findAdminAccount() {
  // 1. DB 中已有管理员
  const admins = accountDb.listAdmins();
  if (admins.length > 0) {
    console.log(`[admin-detect] Found ${admins.length} cached admin(s): ${admins.map(a => a.email).join(", ")}`);
    return admins[0];
  }

  // 2. 没有管理员，扫描所有未判定角色的有效账号
  const unchecked = accountDb.listUncheckedRole();
  if (unchecked.length === 0) {
    console.log("[admin-detect] No unchecked accounts to scan for admin role");
    return null;
  }

  console.log(`[admin-detect] No cached admin, scanning ${unchecked.length} unchecked accounts...`);
  for (const acc of unchecked) {
    const isAdmin = await detectAdminRole(acc);
    if (isAdmin) return accountDb.listAdmins()[0]; // 重新从 DB 读取完整记录
  }

  console.log("[admin-detect] No admin found after scanning all accounts");
  return null;
}

/**
 * 用管理员 token 调 get-team-spend 批量更新所有团队成员的花费数据
 * @returns {Set<string>} 已被覆盖更新的邮箱集合
 */
async function updateTeamSpendFromAdmin(adminAcc) {
  const updatedEmails = new Set();

  // 先获取 teamId
  let teamId = adminAcc.team_id;
  if (!teamId && adminAcc.token) {
    const teamsResp = await cursorApi.fetchTeams(adminAcc.token);
    if (teamsResp.status === 200 && teamsResp.data) {
      const teams = teamsResp.data.teams || (Array.isArray(teamsResp.data) ? teamsResp.data : []);
      if (teams.length > 0) {
        teamId = String(teams[0].id || teams[0].teamId || "");
      }
    }
  }

  if (!teamId) {
    console.log("[team-spend] No teamId available, skip batch update");
    return updatedEmails;
  }

  const token = adminAcc.token;
  if (!token) {
    console.log("[team-spend] Admin has no cookie token, skip batch update");
    return updatedEmails;
  }

  // 先用管理员调 usage-summary 拿 plan.limit（团队共享的套餐上限）
  let planLimitFromAdmin = null;
  let usageResp = await cursorApi.fetchUsageSmart(adminAcc);

  // 管理员 token 401 时，先刷新再重试
  if ((usageResp.status === 401 || usageResp.status === 403 || usageResp.status === 307) && adminAcc.refresh_token) {
    console.log(`[team-spend] Admin ${adminAcc.email}: API 返回 ${usageResp.status}，刷新 token 后重试...`);
    const adminUpdate = { email: adminAcc.email };
    const refreshed = await tryRefreshTokenAndCookie(adminAcc, adminUpdate);
    if (refreshed) {
      accountDb.upsert(adminUpdate);
      usageResp = await cursorApi.fetchUsageSmart(adminAcc);
    }
  }

  if (usageResp.status === 200 && usageResp.data) {
    const plan = usageResp.data.individualUsage?.plan;
    if (plan && plan.limit != null) {
      planLimitFromAdmin = +(plan.limit / 100).toFixed(2);
      console.log(`[team-spend] Got plan.limit from admin usage-summary: $${planLimitFromAdmin}`);
    }
  }

  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    let resp = await cursorApi.fetchTeamSpend(adminAcc.token, teamId, page, 50);

    // team-spend 401 时刷新管理员 token 后重试
    if ((resp.status === 401 || resp.status === 403 || resp.status === 307) && adminAcc.refresh_token) {
      console.log(`[team-spend] fetchTeamSpend 401, refreshing admin token...`);
      const adminUpdate = { email: adminAcc.email };
      const refreshed = await tryRefreshTokenAndCookie(adminAcc, adminUpdate);
      if (refreshed) {
        accountDb.upsert(adminUpdate);
        resp = await cursorApi.fetchTeamSpend(adminAcc.token, teamId, page, 50);
      }
    }

    if (resp.status !== 200 || !resp.data) {
      console.log(`[team-spend] fetchTeamSpend page ${page}: ${resp.status} ${resp.raw || ""}`);
      break;
    }

    const data = resp.data;
    totalPages = data.totalPages || 1;
    const members = data.teamMemberSpend || [];

    console.log(`[team-spend] Page ${page}/${totalPages}: updating ${members.length} members`);

    for (const member of members) {
      const email = member.email || "";
      if (!email) continue;

      // 花费映射（4 个值，与 usage-summary 对齐）：
      // includedSpendCents = plan.breakdown.total（含 bonus），不是 plan.used
      // plan_used = min(includedSpendCents, plan_limit_cents) / 100（截断到上限）
      // plan_limit = 管理员 usage-summary 的 plan.limit
      // on_demand_used = spendCents / 100（= onDemand.used）
      // on_demand_limit = effectivePerUserLimitDollars（= onDemand.limit / 100）
      const planLimitCents = planLimitFromAdmin != null ? Math.round(planLimitFromAdmin * 100) : null;
      const planUsedCents = member.includedSpendCents != null && planLimitCents != null
        ? Math.min(member.includedSpendCents, planLimitCents)
        : (member.includedSpendCents || 0);
      const planUsed = +(planUsedCents / 100).toFixed(2);
      const onDemandUsed = member.spendCents != null ? +(member.spendCents / 100).toFixed(2) : 0;
      const onDemandLimit = member.effectivePerUserLimitDollars != null ? member.effectivePerUserLimitDollars : null;

      const update = {
        email,
        plan_used: planUsed,
        plan_limit: planLimitFromAdmin,
        on_demand_used: onDemandUsed,
        on_demand_limit: onDemandLimit,
        team_role: member.role || "TEAM_ROLE_MEMBER",
        is_admin: member.role === "TEAM_ROLE_OWNER" ? 1 : 0,
        org_name: adminAcc.org_name || "",
        org_id: String(teamId),
        team_id: String(teamId),
        last_checked: new Date().toISOString(),
      };

      // 如果账号不存在，先创建（作为 new 账号入库）
      if (!accountDb.exists(email)) {
        update.account_status = "new";
        update.token_valid = 0;
      }

      accountDb.upsert(update);
      updatedEmails.add(email);
    }

    page++;
  }

  console.log(`[team-spend] Batch updated ${updatedEmails.size} members from admin ${adminAcc.email}`);
  return updatedEmails;
}

// ========== 失败账号定时重试 ==========

function startRetryFailedTimer() {
  stopRetryFailedTimer();
  if (!retryFailedEnabled) return;

  const [h, m] = retryFailedTime.split(":").map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  const msUntilTarget = target - now;

  console.log(`[retry-failed] Scheduled at ${retryFailedTime}, next run in ${Math.round(msUntilTarget / 60000)} min`);

  retryFailedTimer = setTimeout(async () => {
    await runRetryFailed();
    // 24小时后再次执行
    retryFailedTimer = setInterval(() => runRetryFailed(), 24 * 60 * 60 * 1000);
  }, msUntilTarget);
}

function stopRetryFailedTimer() {
  if (retryFailedTimer) {
    clearTimeout(retryFailedTimer);
    clearInterval(retryFailedTimer);
    retryFailedTimer = null;
  }
}

async function runRetryFailed() {
  // ===== 阶段 1：主动刷新所有有 refresh_token 账号的 access_token =====
  const allAccounts = accountDb.listAll().filter(a => a.refresh_token && a.account_status !== "disabled");
  if (allAccounts.length > 0) {
    console.log(`[retry-failed] 刷新 ${allAccounts.length} 个账号的 access_token...`);
    sendToRenderer("retryFailed:refreshStart", { count: allAccounts.length });
    let refreshed = 0;
    for (const acc of allAccounts) {
      const update = { email: acc.email };
      const success = await tryRefreshTokenAndCookie(acc, update);
      if (success) {
        accountDb.upsert(update);
        refreshed++;
        console.log(`[retry-failed] ${acc.email}: access_token + cookie 刷新成功`);
      } else {
        console.log(`[retry-failed] ${acc.email}: access_token 刷新失败`);
      }
      // 每个之间延迟 500ms 避免频繁请求
      await new Promise(r => setTimeout(r, 500));
    }
    console.log(`[retry-failed] Token 刷新完成: ${refreshed}/${allAccounts.length} 成功`);
    sendToRenderer("retryFailed:refreshDone", { total: allAccounts.length, refreshed });
  }

  // ===== 阶段 2：重试失败和新入库的账号登录 =====
  const failedAccounts = accountDb.listByStatus("failed");
  const newAccounts = accountDb.listByStatus("new");
  const retryList = [...failedAccounts, ...newAccounts];

  if (retryList.length === 0) {
    console.log("[retry-failed] No failed/new accounts to retry");
    return;
  }

  const emails = retryList.map(a => a.email);
  console.log(`[retry-failed] Retrying ${emails.length} accounts at ${new Date().toLocaleTimeString()}...`);
  sendToRenderer("retryFailed:start", { count: emails.length });

  try {
    const results = await loginService.batchLogin(emails, DEFAULT_PASSWORD, false, (progress) => {
      sendToRenderer("login:progress", progress);
    });

    let success = 0;
    for (const r of results) {
      if (saveLoginResult(r)) success++;
    }

    console.log(`[retry-failed] Done: ${success}/${emails.length} success`);
    sendToRenderer("retryFailed:done", { total: emails.length, success });
  } catch (err) {
    console.error("[retry-failed] Error:", err.message);
    sendToRenderer("retryFailed:done", { total: emails.length, success: 0, error: err.message });
  }
}

async function runAutoCheck() {
  if (autoCheckRunning) {
    console.log("[auto-check] Already running, skip this round");
    return;
  }
  autoCheckRunning = true;
  try {
  console.log("[auto-check] Starting scheduled check...");
  lastAutoCheckTime = new Date().toISOString();
  sendToRenderer("autoCheck:started", { time: lastAutoCheckTime });

  const accounts = accountDb.listAll().filter(a => a.account_status !== "disabled");
  const results = [];

  // ===== 阶段 1：找管理员 =====
  const adminAcc = await findAdminAccount();

  // ===== 阶段 2：管理员批量更新团队花费 =====
  let teamSpendCovered = new Set();
  if (adminAcc) {
    try {
      teamSpendCovered = await updateTeamSpendFromAdmin(adminAcc);
      sendToRenderer("autoCheck:adminUpdate", {
        admin: adminAcc.email,
        covered: teamSpendCovered.size,
      });
    } catch (e) {
      console.error("[auto-check] Admin batch update failed:", e.message);
    }
  } else {
    console.log("[auto-check] No admin available, falling back to per-account check");
  }

  // ===== 阶段 3：逐个检查未被 team-spend 覆盖的账号 =====
  // 只检查有 token 且非 disabled 的账号（team-spend 已更新花费的可跳过 usage 查询，但仍需检查 token 有效性）
  const needsIndividualCheck = accounts.filter(a => {
    // 没有 token 的账号（new/failed）如果已被 team-spend 覆盖了花费，就不需要单独检查
    if (!a.token && !a.access_token) return !teamSpendCovered.has(a.email);
    // 有 token 的账号：如果被 team-spend 覆盖了花费，跳过 usage 查询，但仍可能需要检查 stripe 等
    return !teamSpendCovered.has(a.email);
  });

  console.log(`[auto-check] ${teamSpendCovered.size} covered by admin, ${needsIndividualCheck.length} need individual check`);

  for (let i = 0; i < needsIndividualCheck.length; i++) {
    if (i > 0) {
      const jitter = 1000 + Math.random() * 4000;
      await new Promise(r => setTimeout(r, jitter));
    }

    const acc = needsIndividualCheck[i];
    sendToRenderer("refresh:progress", { current: i + 1, total: needsIndividualCheck.length, email: acc.email });

    try {
      const update = await checkSingleAccount(acc);
      accountDb.upsert(update);
      const ok = update.account_status !== "failed";
      results.push({ email: acc.email, success: ok });
    } catch (e) {
      results.push({ email: acc.email, success: false, error: e.message });
    }
  }

  // 组织成员发现（优先用管理员 token）
  if (orgDiscoveryEnabled) {
    await discoverOrgMembers(accounts);
  } else {
    console.log("[auto-check] Org discovery disabled, skipping");
  }

  sendToRenderer("autoCheck:finished", {
    time: new Date().toISOString(),
    results: results.length + teamSpendCovered.size,
    success: results.filter(r => r.success).length + teamSpendCovered.size,
    failed: results.filter(r => !r.success).length,
    adminCovered: teamSpendCovered.size,
  });

  console.log(`[auto-check] Done. Admin covered: ${teamSpendCovered.size}, individual: ${results.filter(r => r.success).length} ok, ${results.filter(r => !r.success).length} failed`);

  try {
    accountDb.recordSnapshots(new Date().toISOString().slice(0, 10), accountDb.listAll());
  } catch (e) {
    console.error("[auto-check] Failed to record usage snapshots:", e.message);
  }

  // Update tray menu
  trayHandle?.updateMenu?.();

  // Webhook: build rich payload
  const webhookSettings = getWebhookSettings();
  try {
    const all = accountDb.listAll();
    const scorable = all.filter(a => a.account_status !== "disabled");
    const active = scorable.filter(a => a.account_status === "active");
    const withToken = scorable.filter(a => a.token_valid);
    const withData = active.filter(a => a.plan_limit != null || a.on_demand_limit != null);
    const withBalance = withData.filter(a => ((a.plan_limit||0)+(a.on_demand_limit||0)) > ((a.plan_used||0)+(a.on_demand_used||0)));
    const totalBalance = withBalance.reduce((s, a) => s + ((a.plan_limit||0)+(a.on_demand_limit||0)-(a.plan_used||0)-(a.on_demand_used||0)), 0);
    const newCount = scorable.filter(a => a.account_status === "new").length;
    const failedCount = scorable.filter(a => a.account_status === "failed").length;

    const tokenH = scorable.length > 0 ? Math.round((withToken.length / scorable.length) * 100) : 0;
    const balH = withData.length > 0 ? Math.round((withBalance.length / withData.length) * 100) : 100;
    const covH = scorable.length > 0 ? Math.round(((scorable.length - newCount) / scorable.length) * 100) : 0;
    const healthScore = Math.round(tokenH * 0.35 + balH * 0.3 + 80 * 0.2 + covH * 0.15);
    const healthGrade = healthScore >= 90 ? "A" : healthScore >= 75 ? "B" : healthScore >= 60 ? "C" : healthScore >= 40 ? "D" : "F";

    // Current IDE account
    let currentEmail = "";
    try { currentEmail = cursorDb.readAuth()?.cachedEmail || ""; } catch {}

    dispatchWebhook(webhookSettings, WEBHOOK_EVENTS.AUTO_CHECK_DONE, {
      total: scorable.length,
      success: results.filter(r => r.success).length + teamSpendCovered.size,
      failed: results.filter(r => !r.success).length,
      healthScore, healthGrade, tokenH, balH, covH,
      activeCount: active.length,
      withBalanceCount: withBalance.length,
      totalBalance: +totalBalance.toFixed(2),
      newCount, failedCount,
      currentEmail,
    });
  } catch (e) {
    console.error("[auto-check] Webhook dispatch failed:", e.message);
  }

  return results;
  } finally {
    autoCheckRunning = false;
  }
}

/** 手动刷新：管理员优先批量更新 + 未覆盖账号并发检查 */
async function runQuickRefresh() {
  console.log("[refresh] Starting quick refresh...");
  const accounts = accountDb.listAll().filter(a => a.account_status !== "disabled");
  const results = [];

  // 管理员优先批量更新
  const adminAcc = await findAdminAccount();
  let teamSpendCovered = new Set();
  if (adminAcc) {
    try {
      teamSpendCovered = await updateTeamSpendFromAdmin(adminAcc);
    } catch (e) {
      console.error("[refresh] Admin batch update failed:", e.message);
    }
  }

  // 未覆盖的账号并发检查
  const needsCheck = accounts.filter(a => !teamSpendCovered.has(a.email));
  console.log(`[refresh] ${teamSpendCovered.size} covered by admin, ${needsCheck.length} need individual check`);

  const BATCH_SIZE = 5;
  for (let i = 0; i < needsCheck.length; i += BATCH_SIZE) {
    const batch = needsCheck.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (acc, idx) => {
        sendToRenderer("refresh:progress", { current: i + idx + 1, total: needsCheck.length, email: acc.email });
        const update = await checkSingleAccount(acc);
        accountDb.upsert(update);
        const ok = update.account_status !== "failed";
        return { email: acc.email, success: ok };
      })
    );
    for (const r of batchResults) {
      results.push(r.status === "fulfilled" ? r.value : { email: "?", success: false });
    }
  }

  sendToRenderer("refresh:done", { total: results.length + teamSpendCovered.size, success: results.filter(r => r.success).length + teamSpendCovered.size });
  console.log(`[refresh] Done. Admin covered: ${teamSpendCovered.size}, individual: ${results.filter(r => r.success).length} ok, ${results.filter(r => !r.success).length} failed`);
  return results;
}

/**
 * 通用辅助：尝试刷新 acc 的 access_token + cookie
 * 会修改 acc 和 update 对象，返回是否刷新成功
 */
async function tryRefreshTokenAndCookie(acc, update) {
  const { tryRefreshTokenAndCookie: _try } = await import("./services/account-checker.js");
  return _try(acc, update, tokenExchange);
}

// hasValidCredentials imported from auth-utils.js

function saveLoginResult(r) {
  if (r.success && r.token) {
    const data = { email: r.email, token: r.token, account_status: "active", token_valid: 1 };
    if (r.accessToken) data.access_token = r.accessToken;
    if (r.refreshToken) data.refresh_token = r.refreshToken;
    accountDb.upsert(data);
    detectAdminRole({ email: r.email, token: r.token }).catch(() => {});
    return true;
  }
  accountDb.upsert({ email: r.email, account_status: "failed", token_valid: 0 });
  return false;
}

async function checkSingleAccount(acc) {
  const { checkSingleAccount: _check } = await import("./services/account-checker.js");
  const update = await _check(acc, { cursorApi, tokenExchange, hasValidCredentials });

  // 如果检测到 auth0 格式的 email 被解析为真实邮箱，执行 rename
  if (update._resolvedEmail) {
    const realEmail = update._resolvedEmail;
    delete update._resolvedEmail;
    try {
      const renamed = accountDb.renameEmail(acc.email, realEmail);
      if (renamed) {
        console.log(`[check] 已将 ${acc.email} 重命名为 ${realEmail}`);
        update.email = realEmail;
      }
    } catch (e) {
      console.error(`[check] renameEmail 失败: ${e.message}`);
    }
  }

  return update;
}

/** 用已有有效 Token 拉组织计费成员，发现新成员自动加入 DB */
async function discoverOrgMembers(accounts) {
  const validAccounts = accounts.filter(a => a.token_valid === 1 && a.token);
  if (validAccounts.length === 0) return;

  // 优先用管理员 token
  const admins = accountDb.listAdmins().filter(a => a.token);
  const preferredAccounts = admins.length > 0 ? [...admins, ...validAccounts] : validAccounts;

  // Step 1: 确定 teamId
  let teamId = null;
  let teamName = "Team";
  for (const acc of preferredAccounts) {
    if (acc.team_id) { teamId = acc.team_id; teamName = acc.org_name || "Team"; break; }
  }

  if (!teamId) {
    const teamsResp = await cursorApi.fetchTeams(preferredAccounts[0].token);
    if (teamsResp.status !== 200 || !teamsResp.data) {
      console.log("[org-discovery] fetchTeams:", teamsResp.status, teamsResp.raw || "");
      return;
    }
    const teamsData = teamsResp.data;
    const teams = Array.isArray(teamsData) ? teamsData : teamsData.teams || [];
    if (teams.length === 0) { console.log("[org-discovery] No teams found"); return; }
    teamId = teams[0].teamId || teams[0].id;
    teamName = teams[0].name || teams[0].teamName || "Team";
  }

  if (!teamId) return;

  // Step 2: 用 get-team-spend 拉取计费成员（分页），优先管理员 Token
  const token = preferredAccounts[0].token;
  let page = 1;
  let totalPages = 1;
  let discovered = 0;
  const newlyDiscovered = new Set();

  while (page <= totalPages) {
    const resp = await cursorApi.fetchTeamSpend(token, teamId, page, 50);
    if (resp.status !== 200 || !resp.data) {
      console.log(`[org-discovery] fetchTeamSpend page ${page}:`, resp.status, resp.raw || "");
      break;
    }

    const data = resp.data;
    totalPages = data.totalPages || 1;
    const members = data.teamMemberSpend || [];

    console.log(`[org-discovery] Page ${page}/${totalPages}: ${members.length} members (total: ${data.totalMembers || "?"})`);

    for (const member of members) {
      const email = member.email || "";
      if (!email) continue;

      if (!accountDb.exists(email)) {
        accountDb.upsert({
          email,
          account_status: "new",
          org_name: teamName,
          org_id: String(teamId),
          token_valid: 0,
        });
        discovered++;
        newlyDiscovered.add(email);
      } else {
        accountDb.upsert({ email, org_name: teamName, org_id: String(teamId) });
      }
    }
    page++;
  }

  if (discovered > 0) {
    console.log(`[org-discovery] Discovered ${discovered} new billable members`);
    sendToRenderer("org:newMembers", { count: discovered });
  } else {
    console.log("[org-discovery] No new members found");
  }

  // 对所有 new 且没有 token 的账号尝试自动登录（失败会标记为 failed，下次不再重试）
  const needLogin = accountDb.listAll().filter(a =>
    a.account_status === "new" && !a.token && !a.access_token
  );

  if (needLogin.length > 0) {
    const loginEmails = needLogin.map(a => a.email);
    console.log(`[org-discovery] Auto-login ${loginEmails.length} accounts (new/failed without token)...`);
    sendToRenderer("org:autoLoginStart", { count: loginEmails.length });
    try {
      const results = await loginService.batchLogin(loginEmails, DEFAULT_PASSWORD, false, (progress) => {
        sendToRenderer("login:progress", progress);
      });
      let loginSuccess = 0;
      for (const r of results) {
        if (saveLoginResult(r)) loginSuccess++;
      }
      console.log(`[org-discovery] Auto-login done: ${loginSuccess}/${loginEmails.length} success`);
      sendToRenderer("org:autoLoginDone", { total: loginEmails.length, success: loginSuccess });
    } catch (err) {
      console.error("[org-discovery] Auto-login failed:", err.message);
      sendToRenderer("org:autoLoginDone", { total: loginEmails.length, success: 0, error: err.message });
    }
  }
}

function registerIpcHandlers() {
  // -- Cursor DB --
  ipcMain.handle("cursor:readAuth", () => cursorDb.readAuth());

  // -- Cursor API --
  ipcMain.handle("api:fetchUsage", (_, token) => cursorApi.fetchUsage(token));
  ipcMain.handle("api:fetchStripe", (_, token) => cursorApi.fetchStripe(token));
  ipcMain.handle("api:fetchTeams", (_, token) => cursorApi.fetchTeams(token));

  // -- Account DB --
  ipcMain.handle("accounts:list", () => accountDb.listAll());
  ipcMain.handle("accounts:listByStatus", (_, status) => accountDb.listByStatus(status));
  ipcMain.handle("accounts:upsert", (_, account) => accountDb.upsert(account));
  ipcMain.handle("accounts:remove", (_, emails) => accountDb.remove(emails));

  // 手动停用账号
  ipcMain.handle("accounts:disable", (_, emails) => {
    for (const email of emails) {
      accountDb.upsert({ email, account_status: "disabled", token_valid: 0 });
    }
    console.log(`[accounts] Disabled ${emails.length} accounts: ${emails.join(", ")}`);
    return { success: true, count: emails.length };
  });

  // 手动恢复账号为 active
  ipcMain.handle("accounts:activate", (_, emails) => {
    for (const email of emails) {
      const acc = accountDb.listAll().find(a => a.email === email);
      const hasToken = acc && (acc.token || acc.access_token);
      accountDb.upsert({ email, account_status: "active", token_valid: hasToken ? 1 : 0 });
    }
    console.log(`[accounts] Activated ${emails.length} accounts: ${emails.join(", ")}`);
    return { success: true, count: emails.length };
  });

  // ========== 新增：单点/批量重试认证逻辑 ==========
  ipcMain.handle("accounts:retrySingle", async (_, email) => {
    const acc = accountDb.listAll().find(a => a.email === email);
    if (!acc) return { success: false, error: "Account not found" };
    try {
      const update = await checkSingleAccount(acc);
      accountDb.upsert(update);
      return { success: update.account_status !== "failed", update };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("accounts:retryBatch", async (_, emails) => {
    const results = [];
    for (const email of emails) {
      const acc = accountDb.listAll().find(a => a.email === email);
      if (!acc) continue;
      try {
        const update = await checkSingleAccount(acc);
        accountDb.upsert(update);
        results.push({ email, success: update.account_status !== "failed" });
      } catch (e) {
        results.push({ email, success: false, error: e.message });
      }
    }
    return results;
  });

  ipcMain.handle("accounts:importTokensJson", (_, data) => accountDb.importFromTokensJson(data));
  ipcMain.handle("accounts:exportTokensJson", () => accountDb.exportToTokensJson());

  // -- Full Export (save dialog → JSON file with all fields) --
  ipcMain.handle("accounts:exportFull", async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: "导出账号数据",
      defaultPath: `cursor-accounts-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (canceled || !filePath) return { success: false };
    const accounts = accountDb.listAll();
    fs.writeFileSync(filePath, JSON.stringify(accounts, null, 2), "utf-8");
    return { success: true, count: accounts.length, filePath };
  });

  // -- Full Import (open dialog → load JSON file, upsert all) --
  ipcMain.handle("accounts:importFull", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "导入账号数据",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (canceled || !filePaths.length) return { success: false };
    const raw = fs.readFileSync(filePaths[0], "utf-8");
    const accounts = JSON.parse(raw);
    if (!Array.isArray(accounts)) throw new Error("文件格式错误：需要 JSON 数组");
    let imported = 0;
    for (const acc of accounts) {
      if (!acc.email) continue;
      accountDb.upsert(acc);
      imported++;
    }
    return { success: true, count: imported };
  });

  // -- Switcher --
  ipcMain.handle("switcher:switch", (_, account, options) =>
    switcher.switchAccount(account, { ...options, accountDb })
  );
  ipcMain.handle("switcher:smartSwitch", () => switcher.smartSwitch(accountDb, cursorApi));

  // -- Machine ID --
  ipcMain.handle("machineId:readCurrent", () => machineIdService.readCurrent());
  ipcMain.handle("machineId:resetRandom", () => {
    const current = machineIdService.readCurrent() || {};
    const ids = machineIdService.generate(current);
    return machineIdService.writeTo(ids);
  });
  ipcMain.handle("machineId:backupOriginal", () => machineIdService.backupOriginal());
  ipcMain.handle("machineId:restoreOriginal", () => machineIdService.restoreOriginal());

  // -- Login --
  ipcMain.handle("login:batch", (_, { emails, password, headless, concurrency }) => {
    return loginService.batchLogin(emails, password, headless, (progress) => {
      sendToRenderer("login:progress", progress);
    }, concurrency || 3);
  });

  ipcMain.handle("login:single", (_, { email, password }) => {
    return loginService.loginAccount(email, password);
  });

  // -- OAuth 浏览器授权登录 --
  ipcMain.handle("oauth:start", () => {
    const result = tokenExchange.startOAuthLogin();
    // 用系统浏览器打开登录 URL
    shell.openExternal(result.loginUrl);
    return result;
  });

  ipcMain.handle("oauth:complete", async (_, loginId) => {
    const result = await tokenExchange.completeOAuthLogin(loginId);
    if (result.success) {
      let email = result.email;

      // 如果 OAuth 没能获取到邮箱（authId 是 Auth0 格式如 auth0|user_xxx），
      // 用 cookie 调 /api/auth/me 获取真实邮箱
      if (!email || !email.includes("@")) {
        try {
          if (result.cookie) {
            const meResp = await cursorApi.fetchAuthMe(result.cookie);
            if (meResp.status === 200 && meResp.data && meResp.data.email) {
              email = meResp.data.email;
              console.log(`[oauth] 通过 /api/auth/me 获取到真实邮箱: ${email}`);
            }
          }
        } catch (e) {
          console.log(`[oauth] 获取邮箱失败: ${e.message}`);
        }
      }

      // 最终 fallback
      if (!email || !email.includes("@")) {
        email = result.authId || "unknown";
        console.log(`[oauth] 警告：无法获取真实邮箱，使用 authId 作为标识: ${email}`);
      }

      // 自动入库
      const data = {
        email,
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        account_status: "active",
        token_valid: 1,
      };
      if (result.cookie) data.token = result.cookie;
      accountDb.upsert(data);
      console.log(`[oauth] 账号已入库: ${data.email}`);

      // 异步检测管理员角色
      detectAdminRole({ email: data.email, token: result.cookie, access_token: result.accessToken }).catch(() => {});
    }
    return result;
  });

  ipcMain.handle("oauth:cancel", (_, loginId) => {
    tokenExchange.cancelOAuthLogin(loginId);
    return { success: true };
  });

  // -- Token Exchange: Cookie → accessToken --
  ipcMain.handle("accounts:exchangeToken", async (_, email) => {
    const acc = accountDb.listAll().find((a) => a.email === email);
    if (!acc?.token) return { success: false, error: "no_cookie" };
    const result = await tokenExchange.exchangeCookieToTokens(acc.token);
    if (result.success) {
      accountDb.upsert({
        email,
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      });
    }
    return result;
  });

  // -- Batch Token Exchange: 批量 Cookie → accessToken --
  ipcMain.handle("accounts:exchangeAllTokens", async () => {
    const accounts = accountDb.listAll().filter((a) => a.token && !a.access_token);
    const results = [];
    for (const acc of accounts) {
      sendToRenderer("exchange:progress", { email: acc.email, current: results.length + 1, total: accounts.length });
      const result = await tokenExchange.exchangeCookieToTokens(acc.token);
      if (result.success) {
        accountDb.upsert({
          email: acc.email,
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
        });
      }
      results.push({ email: acc.email, ...result });
      // 每个之间延迟 1 秒避免频繁请求
      await new Promise((r) => setTimeout(r, 1000));
    }
    return results;
  });

  // -- Refresh all tokens (手动触发, 并发无延迟) --
  ipcMain.handle("accounts:refreshAll", () => runQuickRefresh());

  // -- Refresh single account --
  ipcMain.handle("accounts:refreshSingle", async (_, email) => {
    const acc = accountDb.listAll().find(a => a.email === email);
    if (!acc) return { success: false, error: "Account not found" };
    try {
      const update = await checkSingleAccount(acc);
      accountDb.upsert(update);
      return { success: true, update };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // -- Schedule settings (org discovery + retry failed + logging + auto-check interval) --
  ipcMain.handle("schedule:updateSettings", (_, settings) => {
    if (settings.orgDiscoveryEnabled !== undefined) orgDiscoveryEnabled = settings.orgDiscoveryEnabled;
    if (settings.retryFailedEnabled !== undefined) retryFailedEnabled = settings.retryFailedEnabled;
    if (settings.retryFailedTime !== undefined) retryFailedTime = settings.retryFailedTime;
    if (settings.enableLogging !== undefined) logger.setEnabled(settings.enableLogging);
    if (settings.autoCheckMinutes !== undefined) {
      autoCheckIntervalMs = Math.max(5, settings.autoCheckMinutes) * 60 * 1000;
      startAutoCheck();
    }
    
    if (settings.webhookEnabled !== undefined || settings.webhookUrl !== undefined) {
      setWebhookSettings(settings);
    }
    
    startRetryFailedTimer();
    console.log(`[schedule] Updated: orgDiscovery=${orgDiscoveryEnabled}, retryFailed=${retryFailedEnabled} at ${retryFailedTime}, autoCheck=${autoCheckIntervalMs / 60000}min, enableLogging=${settings.enableLogging}`);
    return { orgDiscoveryEnabled, retryFailedEnabled, retryFailedTime, autoCheckMinutes: autoCheckIntervalMs / 60000, enableLogging: settings.enableLogging };
  });

  ipcMain.handle("schedule:retryNow", () => runRetryFailed());

  // -- Logger --
  ipcMain.handle("logger:getAll", () => logger.getAll());
  ipcMain.handle("logger:clear", () => logger.clear());
  ipcMain.handle("logger:setEnabled", (_, enabled) => logger.setEnabled(enabled));
  ipcMain.handle("logger:addRendererLog", (_, level, message) => logger.addRendererLog(level, message));
  ipcMain.handle("logger:openDir", () => {
    const logDir = app.getPath("userData");
    shell.openPath(logDir);
  });

  // -- 团队成员发现 (手动触发) --
  ipcMain.handle("accounts:discoverTeam", async () => {
    const accounts = accountDb.listAll();
    await discoverOrgMembers(accounts);
    return { success: true };
  });

  // -- Auto Check --
  ipcMain.handle("autoCheck:setInterval", (_, minutes) => {
    autoCheckIntervalMs = Math.max(5, minutes) * 60 * 1000;
    startAutoCheck();
    return { interval: autoCheckIntervalMs / 60000 };
  });

  ipcMain.handle("autoCheck:getStatus", () => ({
    running: !!autoCheckTimer,
    intervalMinutes: autoCheckIntervalMs / 60000,
    lastCheckTime: lastAutoCheckTime,
  }));

  ipcMain.handle("autoCheck:runNow", () => runAutoCheck());

  ipcMain.handle("autoCheck:stop", () => {
    stopAutoCheck();
    return { running: false };
  });

  ipcMain.handle("autoCheck:toggle", () => {
    if (autoCheckTimer) {
      stopAutoCheck();
    } else {
      startAutoCheck();
    }
    return { running: !!autoCheckTimer, intervalMinutes: autoCheckIntervalMs / 60000 };
  });

  // -- File dialogs --
  ipcMain.handle("dialog:openFile", async (_, options) => {
    return dialog.showOpenDialog(mainWindow, options);
  });
  ipcMain.handle("dialog:saveFile", async (_, options) => {
    return dialog.showSaveDialog(mainWindow, options);
  });

  // -- Updater --
  ipcMain.handle("updater:check", () => checkForUpdates());
  ipcMain.handle("updater:install", () => quitAndInstall());

  ipcMain.handle("app:getVersion", () => app.getVersion());

  // -- Usage History --
  ipcMain.handle("history:get", (_, days) => accountDb.getUsageHistory(days || 30));

  // -- Tags --
  ipcMain.handle("tags:getAll", () => accountDb.getAllTags());

  // -- Report Export --
  ipcMain.handle("report:exportCSV", async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: "导出使用报告",
      defaultPath: `cursor-report-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (canceled || !filePath) return { success: false };
    const accounts = accountDb.listAll();
    const csv = generateCSV(accounts);
    fs.writeFileSync(filePath, "\uFEFF" + csv, "utf-8"); // BOM for Excel compatibility
    return { success: true, count: accounts.length, filePath };
  });

  // -- Webhook --
  ipcMain.handle("webhook:test", async (_, settings) => {
    const result = await dispatchWebhook(
      { ...settings, webhookEnabled: true },
      WEBHOOK_EVENTS.AUTO_CHECK_DONE,
      { total: 67, success: 67, failed: 0, healthScore: 92, healthGrade: "A", message: "测试通知" },
    );
    return result || { success: false, error: "no_result" };
  });

  ipcMain.handle("feishu:listChats", async (_, appId, appSecret) => {
    return feishuListChats(appId, appSecret);
  });
}
