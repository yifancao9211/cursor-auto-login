import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkSingleAccount, tryRefreshTokenAndCookie } from "../electron/services/account-checker.js";

// Helper: 生成未过期 JWT
function makeJwt(expOffset = 3600) {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = Buffer.from(JSON.stringify({
    sub: "auth0|user_01TEST",
    exp: Math.floor(Date.now() / 1000) + expOffset,
  })).toString("base64url");
  return `${header}.${body}.fakesig`;
}

function makeDeps(overrides = {}) {
  return {
    cursorApi: {
      fetchUsageSmart: vi.fn().mockResolvedValue({ status: 200, data: { membershipType: "free", individualUsage: {} } }),
      fetchStripeSmart: vi.fn().mockResolvedValue({ status: 200, data: {} }),
      ...overrides.cursorApi,
    },
    tokenExchange: {
      refreshAccessToken: vi.fn().mockResolvedValue({ success: false, error: "shouldLogout" }),
      exchangeCookieToTokens: vi.fn().mockResolvedValue({ success: false, error: "failed" }),
      ...overrides.tokenExchange,
    },
    hasValidCredentials: overrides.hasValidCredentials || vi.fn().mockReturnValue(false),
  };
}

// ============================================================
// tryRefreshTokenAndCookie
// ============================================================

describe("tryRefreshTokenAndCookie", () => {
  it("returns false and sets _refreshInvalid when no refresh_token", async () => {
    const acc = { email: "a@b.com" };
    const update = {};
    const tx = { refreshAccessToken: vi.fn() };
    const result = await tryRefreshTokenAndCookie(acc, update, tx);
    expect(result).toBe(false);
    expect(tx.refreshAccessToken).not.toHaveBeenCalled();
  });

  it("returns false and sets _refreshInvalid on refresh failure", async () => {
    const acc = { email: "a@b.com", refresh_token: "rt" };
    const update = {};
    const tx = { refreshAccessToken: vi.fn().mockResolvedValue({ success: false, error: "shouldLogout" }) };
    const result = await tryRefreshTokenAndCookie(acc, update, tx);
    expect(result).toBe(false);
    expect(acc._refreshInvalid).toBe(true);
  });

  it("returns true and updates acc/update on refresh success", async () => {
    const acc = { email: "a@b.com", refresh_token: "rt", token: encodeURIComponent("userId123::oldJwt") };
    const update = {};
    const tx = {
      refreshAccessToken: vi.fn().mockResolvedValue({
        success: true,
        accessToken: "newAccess",
        refreshToken: "newRefresh",
        newCookie: "newCookie",
      }),
    };
    const result = await tryRefreshTokenAndCookie(acc, update, tx);
    expect(result).toBe(true);
    expect(acc.access_token).toBe("newAccess");
    expect(acc.refresh_token).toBe("newRefresh");
    expect(acc.token).toBe("newCookie");
    expect(update.access_token).toBe("newAccess");
    expect(update.token).toBe("newCookie");
  });
});

// ============================================================
// checkSingleAccount
// ============================================================

describe("checkSingleAccount", () => {
  // ------- 基本路径 -------

  it("skips disabled accounts", async () => {
    const deps = makeDeps();
    const update = await checkSingleAccount({ email: "a@b.com", account_status: "disabled" }, deps);
    expect(update.email).toBe("a@b.com");
    expect(update.token_valid).toBeUndefined();
    expect(deps.cursorApi.fetchUsageSmart).not.toHaveBeenCalled();
  });

  it("marks accounts with no tokens as failed", async () => {
    const deps = makeDeps();
    const update = await checkSingleAccount({ email: "a@b.com", account_status: "active" }, deps);
    expect(update.token_valid).toBe(0);
    expect(update.account_status).toBe("failed");
  });

  it("keeps 'new' status for new accounts with no tokens", async () => {
    const deps = makeDeps();
    const update = await checkSingleAccount({ email: "a@b.com", account_status: "new" }, deps);
    expect(update.account_status).toBe("new");
  });

  // ------- API 200 成功 -------

  it("marks account active on API 200", async () => {
    const deps = makeDeps({
      cursorApi: {
        fetchUsageSmart: vi.fn().mockResolvedValue({
          status: 200,
          data: {
            membershipType: "pro",
            individualUsage: {
              onDemand: { used: 500, limit: 5000 },
              plan: { used: 100, limit: 50000 },
            },
            billingCycleEnd: "2026-04-01",
          },
        }),
        fetchStripeSmart: vi.fn().mockResolvedValue({ status: 200, data: {} }),
      },
    });
    const acc = { email: "a@b.com", access_token: makeJwt() };
    const update = await checkSingleAccount(acc, deps);
    expect(update.token_valid).toBe(1);
    expect(update.account_status).toBe("active");
    expect(update.membership_type).toBe("pro");
    expect(update.on_demand_used).toBe(5);
    expect(update.on_demand_limit).toBe(50);
  });

  // ------- 401 + refresh 失败 (shouldLogout 场景) -------

  it("★ marks failed when 401 + refresh returns shouldLogout (even if JWT not expired)", async () => {
    const jwt = makeJwt(3600); // JWT 未过期
    const deps = makeDeps({
      cursorApi: {
        fetchUsageSmart: vi.fn().mockResolvedValue({ status: 401 }),
        fetchStripeSmart: vi.fn().mockResolvedValue({ status: 401 }),
      },
      tokenExchange: {
        refreshAccessToken: vi.fn().mockResolvedValue({ success: false, error: "shouldLogout" }),
      },
      // 模拟 hasValidCredentials 在 JWT 未过期时返回 true（这正是之前的 bug）
      hasValidCredentials: vi.fn().mockReturnValue(true),
    });
    const acc = { email: "a@b.com", access_token: jwt, refresh_token: "rt", account_status: "active" };
    const update = await checkSingleAccount(acc, deps);

    // 关键断言：即使 hasValidCredentials 返回 true，也应标记 failed
    expect(update.token_valid).toBe(0);
    expect(update.account_status).toBe("failed");
  });

  it("★ marks failed when 401 + no refresh_token + expired credentials", async () => {
    const deps = makeDeps({
      cursorApi: {
        fetchUsageSmart: vi.fn().mockResolvedValue({ status: 401 }),
        fetchStripeSmart: vi.fn().mockResolvedValue({ status: 200, data: {} }),
      },
      hasValidCredentials: vi.fn().mockReturnValue(false),
    });
    const acc = { email: "a@b.com", access_token: "expired", account_status: "active" };
    const update = await checkSingleAccount(acc, deps);
    expect(update.token_valid).toBe(0);
    expect(update.account_status).toBe("failed");
  });

  it("keeps status when 401 + no refresh_token but credentials still valid (temp issue)", async () => {
    const deps = makeDeps({
      cursorApi: {
        fetchUsageSmart: vi.fn().mockResolvedValue({ status: 401 }),
        fetchStripeSmart: vi.fn().mockResolvedValue({ status: 200, data: {} }),
      },
      hasValidCredentials: vi.fn().mockReturnValue(true),
    });
    // 没有 refresh_token → 不会尝试刷新 → refreshAttemptedAndFailed = false
    const acc = { email: "a@b.com", access_token: makeJwt(), account_status: "active" };
    const update = await checkSingleAccount(acc, deps);
    // 应保持原状（不标记 failed）
    expect(update.token_valid).toBeUndefined();
    expect(update.account_status).toBeUndefined();
  });

  // ------- 401 + refresh 成功后重试成功 -------

  it("recovers when 401 → refresh success → retry 200", async () => {
    let callCount = 0;
    const deps = makeDeps({
      cursorApi: {
        fetchUsageSmart: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return Promise.resolve({ status: 401 });
          return Promise.resolve({
            status: 200,
            data: { membershipType: "free", individualUsage: {} },
          });
        }),
        fetchStripeSmart: vi.fn().mockResolvedValue({ status: 200, data: {} }),
      },
      tokenExchange: {
        refreshAccessToken: vi.fn().mockResolvedValue({
          success: true,
          accessToken: "newAccess",
          refreshToken: "newRefresh",
        }),
      },
    });
    const acc = { email: "a@b.com", access_token: "old", refresh_token: "rt", account_status: "active" };
    const update = await checkSingleAccount(acc, deps);
    expect(update.token_valid).toBe(1);
    expect(update.account_status).toBe("active");
  });

  // ------- no_token 场景 -------

  it("marks failed when API returns no_token error", async () => {
    const deps = makeDeps({
      cursorApi: {
        fetchUsageSmart: vi.fn().mockResolvedValue({ status: 0, error: "no_token", data: null }),
        fetchStripeSmart: vi.fn().mockResolvedValue({ status: 0 }),
      },
    });
    const acc = { email: "a@b.com", refresh_token: "rt", account_status: "active" };
    const update = await checkSingleAccount(acc, deps);
    expect(update.token_valid).toBe(0);
    expect(update.account_status).toBe("failed");
  });

  // ------- 网络错误保持原状 -------

  it("keeps status on network error (non no_token)", async () => {
    const deps = makeDeps({
      cursorApi: {
        fetchUsageSmart: vi.fn().mockResolvedValue({ status: 0, error: "ECONNREFUSED" }),
        fetchStripeSmart: vi.fn().mockResolvedValue({ status: 0 }),
      },
    });
    const acc = { email: "a@b.com", access_token: makeJwt(), account_status: "active" };
    const update = await checkSingleAccount(acc, deps);
    expect(update.token_valid).toBeUndefined();
    expect(update.account_status).toBeUndefined();
  });

  // ------- cookie → access_token 自动转换 -------

  it("attempts cookie exchange when has cookie but no access_token", async () => {
    const deps = makeDeps({
      tokenExchange: {
        exchangeCookieToTokens: vi.fn().mockResolvedValue({
          success: true,
          accessToken: "fromCookie",
          refreshToken: "fromCookieRefresh",
        }),
        refreshAccessToken: vi.fn(),
      },
    });
    const acc = { email: "a@b.com", token: "somecookie", account_status: "active" };
    const update = await checkSingleAccount(acc, deps);
    expect(deps.tokenExchange.exchangeCookieToTokens).toHaveBeenCalledWith("somecookie");
    expect(update.access_token).toBe("fromCookie");
  });

  // ------- Stripe 数据合并 -------

  it("merges stripe data into update", async () => {
    const deps = makeDeps({
      cursorApi: {
        fetchUsageSmart: vi.fn().mockResolvedValue({ status: 200, data: { membershipType: "free", individualUsage: {} } }),
        fetchStripeSmart: vi.fn().mockResolvedValue({
          status: 200,
          data: { membershipType: "pro", daysRemainingOnTrial: 14, paymentId: "pay_123", teamId: 42 },
        }),
      },
    });
    const acc = { email: "a@b.com", access_token: makeJwt() };
    const update = await checkSingleAccount(acc, deps);
    expect(update.membership_type).toBe("pro"); // stripe overrides usage
    expect(update.days_remaining).toBe(14);
    expect(update.stripe_customer_id).toBe("pay_123");
    expect(update.team_id).toBe("42");
  });
});
