import https from "node:https";
import { generatePKCE } from "./auth-utils.js";

const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2MB

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
        let totalSize = 0;
        res.on("data", (chunk) => {
          totalSize += chunk.length;
          if (totalSize > MAX_BODY_SIZE) { req.destroy(); return; }
          data += chunk;
        });
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

      if (confirmResp.status !== 200 && confirmResp.status !== 307 && confirmResp.status !== 302) {
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
   * 用 refreshToken 刷新获取新的 accessToken，同时生成新的 cookie
   *
   * 使用 Cursor 的认证后端 prod.authentication.cursor.sh/oauth/token
   * 通过 OAuth2 refresh_token grant 获取新的 access_token（60天有效期）
   * refresh_token 可重复使用，实现无限续期
   *
   * 新的 access_token (type=session) 可以用 userId::accessToken 格式作为
   * WorkosCursorSessionToken cookie 使用（已验证 cursor.com API 接受此格式）
   *
   * @param {string} refreshToken - refresh_token 值
   * @param {string} [userId] - 用户 ID（如 user_01KJVR1MJE46Q08N3RF6H67MY0），
   *                            用于构造新 cookie。如未提供则从现有 cookie 或 token 中提取
   * @returns {Promise<{success: boolean, accessToken?: string, refreshToken?: string, newCookie?: string, error?: string}>}
   */
  async refreshAccessToken(refreshToken, userId) {
    if (!refreshToken) return { success: false, error: "no_refresh_token" };

    const CLIENT_ID = "client_01GS6W3C96KW4WRS6Z93JCE2RJ";

    try {
      const resp = await httpRequest(
        "https://prod.authentication.cursor.sh/oauth/token",
        {
          "user-agent": "Cursor/0.50.0",
          "content-type": "application/json",
        },
        "POST",
        {
          client_id: CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }
      );

      if (resp.status === 200) {
        try {
          const data = JSON.parse(resp.raw);
          if (data.access_token && !data.shouldLogout) {
            console.log("[token-refresh] Successfully refreshed accessToken via prod.authentication.cursor.sh");

            // 尝试从 token 中提取 userId（如果没有传入）
            let resolvedUserId = userId;
            if (!resolvedUserId) {
              try {
                const segs = data.access_token.split(".");
                let b64 = segs[1].replace(/-/g, "+").replace(/_/g, "/");
                while (b64.length % 4) b64 += "=";
                const payload = JSON.parse(Buffer.from(b64, "base64").toString());
                // sub 格式: "auth0|user_01KJVR1MJE46Q08N3RF6H67MY0"
                if (payload.sub) {
                  resolvedUserId = payload.sub.split("|").pop();
                }
              } catch {
                // ignore parse errors
              }
            }

            // 构造新 cookie: userId::accessToken (URL encoded)
            let newCookie = null;
            if (resolvedUserId) {
              newCookie = encodeURIComponent(`${resolvedUserId}::${data.access_token}`);
              console.log("[token-refresh] Generated new cookie from refreshed accessToken");
            }

            return {
              success: true,
              accessToken: data.access_token,
              // refresh_token 不变（服务端不返回新的），保留原值继续使用
              refreshToken: data.refresh_token || refreshToken,
              newCookie,
            };
          }

          if (data.shouldLogout) {
            console.log("[token-refresh] Server returned shouldLogout=true, token may be revoked");
            return { success: false, error: "shouldLogout", isAuthError: true };
          }
        } catch {
          // parse error
        }
      }

      console.log(`[token-refresh] Refresh failed: status=${resp.status}, body=${resp.raw?.substring(0, 200)}`);
      // 400, 401, 403 generally mean the refresh token is defunct
      const isAuthError = [400, 401, 403].includes(resp.status);
      return { success: false, error: `refresh returned ${resp.status}`, isAuthError };
    } catch (e) {
      // 纯网络错误 (fetch failed, timeout, ECONNREFUSED)
      return { success: false, error: e.message, isAuthError: false };
    }
  },

  // ========== OAuth 浏览器授权登录（cockpit-tools 风格） ==========

  /** 正在进行的 OAuth 登录状态 */
  _pendingOAuth: null,

  /**
   * 开始 OAuth 登录：生成 PKCE 并返回浏览器 URL
   * @returns {{ loginId: string, uuid: string, verifier: string, loginUrl: string }}
   */
  startOAuthLogin() {
    const { verifier, challenge, uuid } = generatePKCE();
    const loginUrl = `https://cursor.com/loginDeepControl?challenge=${challenge}&uuid=${uuid}&mode=login`;

    this._pendingOAuth = { loginId: uuid, uuid, verifier, cancelled: false, startedAt: Date.now() };
    console.log(`[oauth] 登录会话已创建: loginId=${uuid}`);

    return { loginId: uuid, uuid, verifier, loginUrl };
  },

  /**
   * 等待 OAuth 登录完成：轮询 api2.cursor.sh/auth/poll
   * @param {string} loginId - startOAuthLogin 返回的 loginId
   * @returns {Promise<{success: boolean, accessToken?: string, refreshToken?: string, authId?: string, email?: string, cookie?: string, error?: string}>}
   */
  async completeOAuthLogin(loginId) {
    const pending = this._pendingOAuth;
    if (!pending || pending.loginId !== loginId) {
      return { success: false, error: "no_pending_login" };
    }

    const { uuid, verifier } = pending;
    const pollUrl = `https://api2.cursor.sh/auth/poll?uuid=${uuid}&verifier=${verifier}`;
    const MAX_POLLS = 150;  // 最多 5 分钟 (150 * 2s)
    const POLL_INTERVAL = 2000;

    console.log(`[oauth] 开始轮询，等待用户完成浏览器登录...`);

    for (let i = 0; i < MAX_POLLS; i++) {
      // 检查是否被取消
      if (pending.cancelled) {
        this._pendingOAuth = null;
        return { success: false, error: "cancelled" };
      }

      // 检查是否超时 (5 分钟)
      if (Date.now() - pending.startedAt > 300000) {
        this._pendingOAuth = null;
        return { success: false, error: "timeout" };
      }

      const resp = await httpRequest(pollUrl, { "user-agent": "Cursor/0.50.0", accept: "application/json" });

      if (resp.status === 200) {
        try {
          const data = JSON.parse(resp.raw);
          if (data.accessToken && data.refreshToken) {
            console.log("[oauth] 登录成功，已获取 token");
            this._pendingOAuth = null;

            // 从 accessToken 提取 userId 和 email，构造 cookie
            let cookie = null;
            let email = null;
            try {
              const segs = data.accessToken.split(".");
              let b64 = segs[1].replace(/-/g, "+").replace(/_/g, "/");
              while (b64.length % 4) b64 += "=";
              const payload = JSON.parse(Buffer.from(b64, "base64").toString());
              if (payload.sub) {
                const userId = payload.sub.split("|").pop();
                cookie = encodeURIComponent(`${userId}::${data.accessToken}`);
              }
              // 从 JWT payload 提取邮箱
              if (payload.email) {
                email = payload.email;
              }
            } catch {
              // ignore parse errors
            }

            // fallback：从 authId 提取邮箱
            if (!email && data.authId && data.authId.includes("@")) {
              email = data.authId;
            }

            return {
              success: true,
              accessToken: data.accessToken,
              refreshToken: data.refreshToken,
              authId: data.authId,
              email,
              cookie,
            };
          }
        } catch {
          // ignore parse errors
        }
      }

      if (resp.status !== 404 && resp.status !== 200) {
        console.log(`[oauth] 轮询返回异常状态码: ${resp.status}`);
      }

      if (i % 15 === 0 && i > 0) {
        console.log(`[oauth] 轮询中，等待用户完成登录... (attempt=${i})`);
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }

    this._pendingOAuth = null;
    return { success: false, error: "poll_timeout" };
  },

  /**
   * 取消 OAuth 登录
   * @param {string} [loginId] - 可选，指定要取消的 loginId
   */
  cancelOAuthLogin(loginId) {
    if (this._pendingOAuth) {
      if (!loginId || this._pendingOAuth.loginId === loginId) {
        this._pendingOAuth.cancelled = true;
        console.log(`[oauth] 登录已取消: loginId=${this._pendingOAuth.loginId}`);
      }
    }
  },
};
