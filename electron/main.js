import { app, BrowserWindow, ipcMain, dialog } from "electron";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow;
let autoCheckTimer = null;
let autoCheckIntervalMs = 30 * 60 * 1000; // 默认 30 分钟
let lastAutoCheckTime = null;

function createWindow() {
  mainWindow = new BrowserWindow({
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
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
  });

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

async function runAutoCheck() {
  console.log("[auto-check] Starting scheduled check...");
  lastAutoCheckTime = new Date().toISOString();
  sendToRenderer("autoCheck:started", { time: lastAutoCheckTime });

  const accounts = accountDb.listAll().filter(a => a.account_status !== "disabled");
  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    // 每个账号之间随机延迟 1-5 秒，避免同时打 Cursor API
    if (i > 0) {
      const jitter = 1000 + Math.random() * 4000;
      await new Promise(r => setTimeout(r, jitter));
    }

    const acc = accounts[i];
    sendToRenderer("refresh:progress", { current: i + 1, total: accounts.length, email: acc.email });

    try {
      const update = await checkSingleAccount(acc);
      accountDb.upsert(update);
      results.push({ email: acc.email, success: true });
    } catch (e) {
      results.push({ email: acc.email, success: false, error: e.message });
    }
  }

  // 用第一个有效 Token 拉取组织成员
  await discoverOrgMembers(accounts);

  sendToRenderer("autoCheck:finished", {
    time: new Date().toISOString(),
    results: results.length,
    success: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
  });

  console.log(`[auto-check] Done. ${results.filter(r => r.success).length} ok, ${results.filter(r => !r.success).length} failed`);
  return results;
}

/** 手动刷新：并发检查所有账号，无延迟 */
async function runQuickRefresh() {
  console.log("[refresh] Starting quick refresh...");
  const accounts = accountDb.listAll().filter(a => a.account_status !== "disabled");
  const results = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
    const batch = accounts.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (acc, idx) => {
        sendToRenderer("refresh:progress", { current: i + idx + 1, total: accounts.length, email: acc.email });
        const update = await checkSingleAccount(acc);
        accountDb.upsert(update);
        return { email: acc.email, success: true };
      })
    );
    for (const r of batchResults) {
      results.push(r.status === "fulfilled" ? r.value : { email: "?", success: false });
    }
  }

  sendToRenderer("refresh:done", { total: results.length, success: results.filter(r => r.success).length });
  console.log(`[refresh] Done. ${results.filter(r => r.success).length} ok, ${results.filter(r => !r.success).length} failed`);
  return results;
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

  // 智能调用：优先 Bearer (accessToken → api2.cursor.sh)，fallback Cookie
  const usage = await cursorApi.fetchUsageSmart(acc);
  const stripe = await cursorApi.fetchStripeSmart(acc);

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
    // Token 确实无效（认证失败），标记为 failed
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

  // Step 1: 确定 teamId
  let teamId = null;
  let teamName = "Team";
  for (const acc of validAccounts) {
    if (acc.team_id) { teamId = acc.team_id; teamName = acc.org_name || "Team"; break; }
  }

  if (!teamId) {
    const teamsResp = await cursorApi.fetchTeams(validAccounts[0].token);
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

  // Step 2: 用 get-team-spend 拉取计费成员（分页），任意 Token 即可
  const token = validAccounts[0].token;
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
