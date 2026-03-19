import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

let chromium;
async function getChromium() {
  if (!chromium) {
    const pw = await import("playwright");
    chromium = pw.chromium;
  }
  return chromium;
}

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const uuid = crypto.randomUUID();
  return { verifier, challenge, uuid };
}

async function pollForTokens(uuid, verifier, maxAttempts = 60) {
  const pollUrl = `https://api2.cursor.sh/auth/poll?uuid=${uuid}&verifier=${verifier}`;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await fetch(pollUrl, {
        headers: { "user-agent": "Cursor/0.50.0" },
      });
      if (resp.status === 404) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      const data = await resp.json();
      if (data?.accessToken && data?.refreshToken) {
        return { accessToken: data.accessToken, refreshToken: data.refreshToken, authId: data.authId };
      }
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function loginAccount(email, password) {
  const chr = await getChromium();
  const profileDir = path.join(os.tmpdir(), "cam-sessions", email.replace(/[^a-zA-Z0-9]/g, "_"));
  fs.mkdirSync(profileDir, { recursive: true });

  const context = await chr.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
  });

  const result = { success: false, token: null, accessToken: null, refreshToken: null, error: null };

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    const { verifier, challenge, uuid } = generatePKCE();
    // 关键：使用 cursor.com/loginDeepControl 而不是 authenticator.cursor.sh
    const loginUrl = `https://cursor.com/loginDeepControl?challenge=${challenge}&uuid=${uuid}&mode=login`;

    let gotoOk = false;
    for (let i = 0; i < 3; i++) {
      try {
        await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 30000 });
        gotoOk = true;
        break;
      } catch {
        await page.waitForTimeout(2000);
      }
    }
    if (!gotoOk) {
      result.error = "连接失败";
      return result;
    }
    await page.waitForTimeout(2000);

    // 检查是否已登录：如果已登录，loginDeepControl 会显示 "Yes, Log In" 按钮
    const yesLogInBtn = page.getByRole("button", { name: /yes.*log\s*in/i }).first();
    if (await yesLogInBtn.isVisible().catch(() => false)) {
      // 已登录，直接点击 "Yes, Log In" 完成 PKCE
      await yesLogInBtn.click();
      await page.waitForTimeout(3000);
      result.success = true;
      const cookies = await context.cookies();
      result.token = cookies.find((c) => c.name === "WorkosCursorSessionToken")?.value;
      const polled = await pollForTokens(uuid, verifier);
      if (polled) {
        result.accessToken = polled.accessToken;
        result.refreshToken = polled.refreshToken;
      }
      return result;
    }

    // 未登录：点击 "Continue to sign in"
    const continueBtn = page.getByRole("button", { name: /continue/i }).first();
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click();
      await page.waitForTimeout(3000);
    }

    // 等待 Cloudflare + 邮箱输入框
    const emailInput1 = page.locator('input[type="email"], input[name="email"]').first();
    try {
      await emailInput1.waitFor({ state: "visible", timeout: 30000 });
      await emailInput1.fill(email);
      await page.waitForTimeout(500);
      const btn = page.getByRole("button", { name: /continue|继续|sign in|log in/i });
      if (await btn.isVisible().catch(() => false)) await btn.click();
      else await emailInput1.press("Enter");
    } catch {
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const hint = bodyText.includes("Verify you are human")
        ? " (Cloudflare 人机验证)"
        : bodyText.includes("blocked")
          ? " (被封锁)"
          : "";
      result.error = `邮箱输入框未出现${hint}: ${page.url().substring(0, 80)}`;
      return result;
    }

    await page.waitForTimeout(4000);

    // Auth0 或 authenticator 密码页
    const currentUrl = page.url();
    if (currentUrl.includes("auth0.com")) {
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(2000);

      const emailInput2 = page.locator("#username").first();
      try {
        await emailInput2.waitFor({ state: "visible", timeout: 10000 });
        await emailInput2.click();
        await emailInput2.fill(email);
        await page.waitForTimeout(500);
        await page.evaluate(() => document.querySelector("form")?.submit());
        await page.waitForTimeout(4000);
        await page.waitForLoadState("domcontentloaded");
      } catch {
        // May already be on password step
      }

      const pwdInput = page.locator('#password, input[type="password"]:visible').first();
      try {
        await pwdInput.waitFor({ state: "visible", timeout: 10000 });
      } catch {
        const alert = await page
          .locator('[role="alert"], .ulp-alert')
          .first()
          .textContent()
          .catch(() => "");
        result.error = alert?.trim() || "密码框未出现";
        return result;
      }
      await pwdInput.fill(password);
      await page.waitForTimeout(500);
      await page.evaluate(() => document.querySelector("form")?.submit());
    } else if (currentUrl.includes("authenticator.cursor.sh/password")) {
      const pwdInput = page.locator('input[type="password"]').first();
      await pwdInput.waitFor({ state: "visible", timeout: 8000 });
      await pwdInput.fill(password);
      const btn = page.getByRole("button", { name: /continue|继续/i });
      if (await btn.isVisible().catch(() => false)) await btn.click();
      else await pwdInput.press("Enter");
    } else {
      result.error = `未知页面: ${currentUrl.substring(0, 80)}`;
      return result;
    }

    // 等待跳转回 loginDeepControl（已登录后重定向回来）
    try {
      await page.waitForURL(/cursor\.com\/loginDeepControl/, { timeout: 20000 });
      await page.waitForTimeout(2000);
    } catch {
      // 可能跳到了 dashboard 或其他页面
      if (page.url().includes("auth0.com")) {
        const alert = await page
          .locator('[role="alert"], .ulp-alert')
          .first()
          .textContent()
          .catch(() => "");
        result.error = alert?.trim() || "密码错误";
        return result;
      }
    }

    // 点击 "Yes, Log In" 完成 PKCE
    const yesBtn = page.getByRole("button", { name: /yes.*log\s*in/i }).first();
    try {
      await yesBtn.waitFor({ state: "visible", timeout: 10000 });
      await yesBtn.click();
      await page.waitForTimeout(3000);
      result.success = true;
    } catch {
      // 如果没有 Yes 按钮，可能已经自动完成了
      result.success = page.url().includes("cursor.com");
      if (!result.success) {
        result.error = "未找到确认按钮";
        return result;
      }
    }

    // 获取 web cookie
    const cookies = await context.cookies();
    result.token = cookies.find((c) => c.name === "WorkosCursorSessionToken")?.value;

    // 通过 PKCE 轮询获取 session token（用于 IDE）
    const polled = await pollForTokens(uuid, verifier);
    if (polled) {
      result.accessToken = polled.accessToken;
      result.refreshToken = polled.refreshToken;
    }
  } catch (e) {
    result.error = e.message;
  } finally {
    await context.close();
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  return result;
}

export const loginService = {
  loginAccount,

  async batchLogin(emails, password, _headless = false, onProgress, concurrency = 5) {
    const results = [];
    let completed = 0;

    // 并发控制：同时开 concurrency 个浏览器
    async function runOne(email) {
      if (onProgress) onProgress({ current: completed + 1, total: emails.length, email, status: "logging_in" });

      const lr = await loginAccount(email, password);
      completed++;
      results.push({ email, ...lr });

      if (onProgress) {
        onProgress({
          current: completed,
          total: emails.length,
          email,
          status: lr.success ? "success" : "failed",
          error: lr.error,
        });
      }
    }

    // 分批并发执行
    for (let i = 0; i < emails.length; i += concurrency) {
      const batch = emails.slice(i, i + concurrency);
      await Promise.all(batch.map((email) => runOne(email)));
    }

    return results;
  },
};
