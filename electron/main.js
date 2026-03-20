import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
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
import { updater } from "./services/updater.js";
import { logger } from "./services/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow;
let autoCheckTimer = null;
let autoCheckIntervalMs = 30 * 60 * 1000; // 默认 30 分钟
let lastAutoCheckTime = null;
let orgDiscoveryEnabled = true;
let retryFailedEnabled = false;
let retryFailedTime = "00:00";
let retryFailedTimer = null;

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

app.whenReady().then(() => {
  accountDb.init();
  registerIpcHandlers();
  createWindow();
  // 初始化 logger（传入 sendToRenderer 用于流式推送日志到前端）
  logger.init(sendToRenderer);
  // 初始化自动更新
  updater.init(sendToRenderer);
  // 启动后延迟 10 秒自动巡检一次
  setTimeout(() => runAutoCheck(), 10000);
  startAutoCheck();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});


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
  if ((usageResp.status === 401 || usageResp.status === 403) && adminAcc.refresh_token) {
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
    if ((resp.status === 401 || resp.status === 403) && adminAcc.refresh_token) {
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
    const DEFAULT_PASSWORD = "abcd@1234";
    const results = await loginService.batchLogin(emails, DEFAULT_PASSWORD, false, (progress) => {
      sendToRenderer("login:progress", progress);
    });

    let success = 0;
    for (const r of results) {
      if (r.success && r.token) {
        const data = { email: r.email, token: r.token, account_status: "active", token_valid: 1 };
        if (r.accessToken) data.access_token = r.accessToken;
        if (r.refreshToken) data.refresh_token = r.refreshToken;
        accountDb.upsert(data);
        // 登录成功后检测管理员角色
        detectAdminRole({ email: r.email, token: r.token }).catch(() => {});
        success++;
      }
    }

    console.log(`[retry-failed] Done: ${success}/${emails.length} success`);
    sendToRenderer("retryFailed:done", { total: emails.length, success });
  } catch (err) {
    console.error("[retry-failed] Error:", err.message);
    sendToRenderer("retryFailed:done", { total: emails.length, success: 0, error: err.message });
  }
}

async function runAutoCheck() {
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
      results.push({ email: acc.email, success: true });
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
  return results;
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
        return { email: acc.email, success: true };
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
  if (!acc.refresh_token) return false;

  // 从现有 cookie 提取 userId
  let userId = null;
  if (acc.token) {
    try {
      const decoded = decodeURIComponent(acc.token);
      const idx = decoded.indexOf("::");
      if (idx > 0) userId = decoded.substring(0, idx);
    } catch {}
  }

  const refreshResult = await tokenExchange.refreshAccessToken(acc.refresh_token, userId);
  if (!refreshResult.success) {
    console.log(`[check] ${acc.email}: token 刷新失败(${refreshResult.error})`);
    return false;
  }

  console.log(`[check] ${acc.email}: access_token 刷新成功`);
  acc.access_token = refreshResult.accessToken;
  update.access_token = refreshResult.accessToken;

  if (refreshResult.refreshToken && refreshResult.refreshToken !== acc.refresh_token) {
    acc.refresh_token = refreshResult.refreshToken;
    update.refresh_token = refreshResult.refreshToken;
  }

  if (refreshResult.newCookie) {
    acc.token = refreshResult.newCookie;
    update.token = refreshResult.newCookie;
    console.log(`[check] ${acc.email}: cookie 已同步续期`);
  }

  return true;
}

async function checkSingleAccount(acc) {
  const update = { email: acc.email };

  // 跳过已禁用的账号，保持状态不变
  if (acc.account_status === "disabled") {
    return update;
  }

  if (!acc.token && !acc.access_token) {
    update.token_valid = 0;
    update.account_status = acc.account_status === "new" ? "new" : "failed";
    update.last_checked = new Date().toISOString();
    return update;
  }

  // 如果有 cookie 但没有 access_token，尝试自动转换
  if (acc.token && !acc.access_token) {
    console.log(`[check] ${acc.email}: 有 cookie 无 access_token，尝试自动转换...`);
    const exchangeResult = await tokenExchange.exchangeCookieToTokens(acc.token);
    if (exchangeResult.success) {
      console.log(`[check] ${acc.email}: Cookie → accessToken 转换成功`);
      acc.access_token = exchangeResult.accessToken;
      acc.refresh_token = exchangeResult.refreshToken;
      update.access_token = exchangeResult.accessToken;
      update.refresh_token = exchangeResult.refreshToken;
    } else {
      console.log(`[check] ${acc.email}: Cookie → accessToken 转换失败: ${exchangeResult.error}`);
    }
  }

  // 先调 API 查用量和订阅
  let usage = await cursorApi.fetchUsageSmart(acc);
  let stripe = await cursorApi.fetchStripeSmart(acc);

  // 如果 401/403，尝试刷新 token + cookie 后重试
  if ((usage.status === 401 || usage.status === 403) && acc.refresh_token) {
    console.log(`[check] ${acc.email}: API 返回 ${usage.status}，尝试刷新 token 后重试...`);
    const refreshed = await tryRefreshTokenAndCookie(acc, update);
    if (refreshed) {
      // 用新 token 重试 API
      usage = await cursorApi.fetchUsageSmart(acc);
      stripe = await cursorApi.fetchStripeSmart(acc);
      if (usage.status === 200) {
        console.log(`[check] ${acc.email}: 刷新后重试成功`);
      }
    }
  }

  if (usage.status === 200 && usage.data) {
    const od = usage.data.individualUsage?.onDemand;
    const plan = usage.data.individualUsage?.plan;
    update.membership_type = usage.data.membershipType || null;
    update.on_demand_used = od ? +(od.used / 100).toFixed(2) : null;
    update.on_demand_limit = od ? +(od.limit / 100).toFixed(2) : null;
    update.plan_used = plan ? +(plan.used / 100).toFixed(2) : null;
    update.plan_limit = plan ? +(plan.limit / 100).toFixed(2) : null;
    update.reset_date = usage.data.billingCycleEnd || null;
    update.token_valid = 1;
    update.account_status = "active";
    if (usage.authMethod) console.log(`[check] ${acc.email}: usage via ${usage.authMethod}`);
  } else if (usage.status === 401 || usage.status === 403) {
    // 刷新后仍然 401，才真正标记为 failed
    console.log(`[check] ${acc.email}: 认证失败 (${usage.status})，标记为失效`);
    update.token_valid = 0;
    update.account_status = acc.account_status === "new" ? "new" : (acc.account_status === "disabled" ? "disabled" : "failed");
  } else {
    // 网络错误/超时/服务器错误：保持原有状态，不轻易标记失效
    console.log(`[check] ${acc.email}: API 返回 ${usage.status}，保持现有状态`);
    if (acc.account_status === "active" && (acc.token || acc.access_token)) {
      // 已有 token 的 active 账号：保持不变
    } else {
      update.token_valid = 0;
      update.account_status = acc.account_status === "new" ? "new" : (acc.account_status === "disabled" ? "disabled" : "failed");
    }
  }

  if (stripe.status === 200 && stripe.data) {
    // full_stripe_profile (Bearer) 和 /api/auth/stripe (Cookie) 字段基本一致
    update.membership_type = stripe.data.membershipType || update.membership_type;
    update.days_remaining = stripe.data.daysRemainingOnTrial || 0;
    if (stripe.data.paymentId) update.stripe_customer_id = stripe.data.paymentId;
    if (stripe.data.teamId) update.team_id = String(stripe.data.teamId);
  }

  update.last_checked = new Date().toISOString();
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
      } else {
        accountDb.upsert({ email, org_name: teamName, org_id: String(teamId) });
      }
    }
    page++;
  }

  if (discovered > 0) {
    console.log(`[org-discovery] Discovered ${discovered} new billable members`);
    sendToRenderer("org:newMembers", { count: discovered });

    // 自动登录新发现的成员
    const newAccounts = accountDb.listByStatus("new");
    const newEmails = newAccounts.map(a => a.email);
    if (newEmails.length > 0) {
      console.log(`[org-discovery] Auto-login ${newEmails.length} new members...`);
      sendToRenderer("org:autoLoginStart", { count: newEmails.length });
      try {
        const DEFAULT_PASSWORD = "abcd@1234";
        const results = await loginService.batchLogin(newEmails, DEFAULT_PASSWORD, false, (progress) => {
          sendToRenderer("login:progress", progress);
        });
        let loginSuccess = 0;
        for (const r of results) {
          if (r.success && r.token) {
            const data = { email: r.email, token: r.token, account_status: "active", token_valid: 1 };
            if (r.accessToken) data.access_token = r.accessToken;
            if (r.refreshToken) data.refresh_token = r.refreshToken;
            accountDb.upsert(data);
            // 登录成功后检测管理员角色
            detectAdminRole({ email: r.email, token: r.token }).catch(() => {});
            loginSuccess++;
          }
        }
        console.log(`[org-discovery] Auto-login done: ${loginSuccess}/${newEmails.length} success`);
        sendToRenderer("org:autoLoginDone", { total: newEmails.length, success: loginSuccess });
      } catch (err) {
        console.error("[org-discovery] Auto-login failed:", err.message);
        sendToRenderer("org:autoLoginDone", { total: newEmails.length, success: 0, error: err.message });
      }
    }
  } else {
    console.log("[org-discovery] No new members found");
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

  // -- Schedule settings (org discovery + retry failed + logging) --
  ipcMain.handle("schedule:updateSettings", (_, settings) => {
    if (settings.orgDiscoveryEnabled !== undefined) orgDiscoveryEnabled = settings.orgDiscoveryEnabled;
    if (settings.retryFailedEnabled !== undefined) retryFailedEnabled = settings.retryFailedEnabled;
    if (settings.retryFailedTime !== undefined) retryFailedTime = settings.retryFailedTime;
    if (settings.enableLogging !== undefined) logger.setEnabled(settings.enableLogging);
    
    startRetryFailedTimer();
    console.log(`[schedule] Updated: orgDiscovery=${orgDiscoveryEnabled}, retryFailed=${retryFailedEnabled} at ${retryFailedTime}, enableLogging=${settings.enableLogging}`);
    return { orgDiscoveryEnabled, retryFailedEnabled, retryFailedTime, enableLogging: settings.enableLogging };
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
  ipcMain.handle("updater:check", () => updater.checkForUpdates());
  ipcMain.handle("updater:install", () => updater.installUpdate());
  ipcMain.handle("updater:getVersion", () => updater.getVersion());
}
