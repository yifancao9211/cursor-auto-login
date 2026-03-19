import https from "node:https";
import crypto from "node:crypto";

/**
 * Cookie → accessToken 纯 HTTP 转换服务
 *
 * 流程:
 * 1. 生成 PKCE (verifier, challenge, uuid)
 * 2. GET cursor.com/loginDeepControl (跟踪重定向，收集 cookies)
 * 3. POST cursor.com/api/auth/loginDeepCallbackControl (模拟 "Yes, Log In")
 * 4. 轮询 api2.cursor.sh/auth/poll 获取 accessToken + refreshToken
 */

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const uuid = crypto.randomUUID();
  return { verifier, challenge, uuid };
}

function httpRequest(urlStr, headers, method = "GET", body = null) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const bodyStr = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers, host: url.hostname };
    if (bodyStr) {
      reqHeaders["content-type"] = "application/json";
      reqHeaders["content-length"] = Buffer.byteLength(bodyStr);
    }
    const req = https.request(
      { hostname: url.hostname, path: url.pathname + url.search, method, headers: reqHeaders },
      (res) => {
        const cookies = res.headers["set-cookie"] || [];
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, cookies, raw: data }));
      }
    );
    req.on("error", (e) => resolve({ status: 0, error: e.message }));
    req.setTimeout(20000, () => {
      req.destroy();
      resolve({ status: 0, error: "timeout" });
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/** 跟踪重定向并收集所有 cookies */
async function fetchWithRedirects(urlStr, baseCookie, maxRedirects = 6) {
  let cookie = baseCookie;
  let currentUrl = urlStr;

  for (let i = 0; i < maxRedirects; i++) {
    const resp = await httpRequest(currentUrl, {
      cookie,
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      accept: "text/html,application/xhtml+xml",
    });

    // 累积 set-cookie
    for (const c of resp.cookies) {
      cookie += `; ${c.split(";")[0]}`;
    }

    if (resp.status >= 300 && resp.status < 400 && resp.headers.location) {
      let next = resp.headers.location;
      if (next.startsWith("/")) {
        const u = new URL(currentUrl);
        next = `${u.protocol}//${u.hostname}${next}`;
      }
      currentUrl = next;
      continue;
    }

    return { status: resp.status, cookie, error: resp.error };
  }
  return { status: 0, cookie, error: "too_many_redirects" };
}

/** 轮询 api2.cursor.sh/auth/poll 获取 tokens */
async function pollForTokens(uuid, verifier, maxAttempts = 30) {
  const pollUrl = `https://api2.cursor.sh/auth/poll?uuid=${uuid}&verifier=${verifier}`;
  for (let i = 0; i < maxAttempts; i++) {
    const resp = await httpRequest(pollUrl, { "user-agent": "Cursor/0.50.0" });
    if (resp.status === 200) {
      try {
        const data = JSON.parse(resp.raw);
        if (data.accessToken && data.refreshToken) return data;
      } catch {
        // ignore parse errors
      }
    }
    // 404 表示还没准备好，继续等
    if (resp.status !== 404 && resp.status !== 200) {
      return null; // 其他状态码表示出错
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

export const tokenExchange = {
  /**
   * 将 WorkosCursorSessionToken (cookie) 转换为 accessToken + refreshToken
   *
   * @param {string} cookie - WorkosCursorSessionToken 值
   * @returns {Promise<{success: boolean, accessToken?: string, refreshToken?: string, authId?: string, error?: string}>}
   */
  async exchangeCookieToTokens(cookie) {
    if (!cookie) return { success: false, error: "no_cookie" };

    try {
      const { verifier, challenge, uuid } = generatePKCE();

      // Step 1: GET loginDeepControl (跟踪重定向，建立 session)
      const loginUrl = `https://cursor.com/loginDeepControl?challenge=${challenge}&uuid=${uuid}&mode=login`;
      const { status, cookie: fullCookie, error: redirectError } = await fetchWithRedirects(
        loginUrl,
        `WorkosCursorSessionToken=${cookie}`
      );

      if (redirectError) return { success: false, error: `redirect_failed: ${redirectError}` };
      if (status !== 200) return { success: false, error: `loginDeepControl returned ${status}` };

      // Step 2: POST /api/auth/loginDeepCallbackControl (模拟 "Yes, Log In")
      const confirmResp = await httpRequest(
        "https://cursor.com/api/auth/loginDeepCallbackControl",
        {
          cookie: fullCookie,
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          origin: "https://cursor.com",
          referer: loginUrl,
        },
        "POST",
        { uuid, challenge }
      );

      if (confirmResp.status !== 200) {
        return { success: false, error: `loginDeepCallbackControl returned ${confirmResp.status}` };
      }

      // Step 3: 轮询获取 tokens
      const tokens = await pollForTokens(uuid, verifier);
      if (!tokens) return { success: false, error: "poll_timeout" };

      return {
        success: true,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        authId: tokens.authId,
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /**
   * 用 refreshToken 刷新获取新的 accessToken
   *
   * @param {string} refreshToken - refresh_token 值
   * @returns {Promise<{success: boolean, accessToken?: string, refreshToken?: string, error?: string}>}
   */
  async refreshAccessToken(refreshToken) {
    if (!refreshToken) return { success: false, error: "no_refresh_token" };

    try {
      const resp = await httpRequest(
        "https://api2.cursor.sh/auth/refresh",
        {
          "user-agent": "Cursor/0.50.0",
          "content-type": "application/json",
        },
        "POST",
        { refreshToken }
      );

      if (resp.status === 200) {
        try {
          const data = JSON.parse(resp.raw);
          if (data.accessToken) {
            console.log("[token-refresh] Successfully refreshed accessToken");
            return {
              success: true,
              accessToken: data.accessToken,
              refreshToken: data.refreshToken || refreshToken, // 有些接口会返回新的 refreshToken
            };
          }
        } catch {
          // parse error
        }
      }

      console.log(`[token-refresh] Refresh failed: status=${resp.status}`);
      return { success: false, error: `refresh returned ${resp.status}` };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
};
