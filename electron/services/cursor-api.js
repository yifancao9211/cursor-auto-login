import https from "node:https";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2MB

function makeRequest({ hostname, path: urlPath, method = "GET", headers, body = null, timeout = 15000 }) {
  return new Promise((resolve) => {
    if (body) {
      headers["content-type"] = "application/json";
    }
    const req = https.request({ hostname, path: urlPath, method, headers }, (res) => {
      let data = "";
      let totalSize = 0;
      res.on("data", (chunk) => {
        totalSize += chunk.length;
        if (totalSize > MAX_BODY_SIZE) { req.destroy(); return; }
        data += chunk;
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: null, raw: data.substring(0, 500) });
        }
      });
    });
    req.on("error", (e) => resolve({ status: 0, error: e.message }));
    req.setTimeout(timeout, () => { req.destroy(); resolve({ status: 0, error: "timeout" }); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function request(hostname, urlPath, token, method = "GET", body = null) {
  const headers = {
    accept: "application/json",
    cookie: `WorkosCursorSessionToken=${token}`,
    "user-agent": UA,
    referer: "https://cursor.com/settings",
  };
  if (body) headers["origin"] = "https://cursor.com";
  return makeRequest({ hostname, path: urlPath, method, headers, body });
}

function requestBearer(urlPath, accessToken, method = "GET", body = null) {
  return makeRequest({
    hostname: "api2.cursor.sh",
    path: urlPath,
    method,
    headers: { accept: "application/json", Authorization: `Bearer ${accessToken}`, "user-agent": UA },
    body,
  });
}

export const cursorApi = {
  // ========== Cookie 认证 (cursor.com) ==========

  /** 获取当前用户信息（包含 email） */
  fetchAuthMe(token) {
    return request("cursor.com", "/api/auth/me", token);
  },

  fetchUsage(token) {
    return request("cursor.com", "/api/usage-summary", token);
  },
  fetchStripe(token) {
    return request("cursor.com", "/api/auth/stripe", token);
  },
  /** 获取当前用户的团队列表 (POST) */
  fetchTeams(token) {
    return request("cursor.com", "/api/dashboard/teams", token, "POST", {});
  },
  /** 获取指定团队的计费成员列表 (POST, 分页) */
  fetchTeamSpend(token, teamId, page = 1, pageSize = 50) {
    return request("cursor.com", "/api/dashboard/get-team-spend", token, "POST", {
      teamId: Number(teamId),
      page,
      pageSize,
      sortBy: "name",
      sortDirection: "asc",
    });
  },

  // ========== Bearer 认证 (api2.cursor.sh) ==========

  /** 用量查询 (Bearer) → api2.cursor.sh/auth/usage-summary */
  fetchUsageBearer(accessToken) {
    return requestBearer("/auth/usage-summary", accessToken);
  },
  /** Stripe 信息 (Bearer) → api2.cursor.sh/auth/full_stripe_profile */
  fetchStripeBearer(accessToken) {
    return requestBearer("/auth/full_stripe_profile", accessToken);
  },

  // ========== 智能方法：优先 Bearer，fallback Cookie ==========

  /**
   * 智能查用量：优先 access_token (Bearer)，失败则 fallback 到 token (Cookie)
   * @param {object} account - 账号对象 { access_token, token }
   */
  async fetchUsageSmart(account) {
    if (account.access_token) {
      const result = await this.fetchUsageBearer(account.access_token);
      if (result.status === 200 && result.data) {
        return { ...result, authMethod: "bearer" };
      }
    }
    if (account.token) {
      const result = await this.fetchUsage(account.token);
      return { ...result, authMethod: "cookie" };
    }
    return { status: 0, error: "no_token", data: null };
  },

  /**
   * 智能查 Stripe：优先 access_token (Bearer)，失败则 fallback 到 token (Cookie)
   * @param {object} account - 账号对象 { access_token, token }
   */
  async fetchStripeSmart(account) {
    if (account.access_token) {
      const result = await this.fetchStripeBearer(account.access_token);
      if (result.status === 200 && result.data) {
        return { ...result, authMethod: "bearer" };
      }
    }
    if (account.token) {
      const result = await this.fetchStripe(account.token);
      return { ...result, authMethod: "cookie" };
    }
    return { status: 0, error: "no_token", data: null };
  },
};
