/**
 * checkSingleAccount 核心逻辑 — 从 main.js 提取，方便测试
 *
 * 依赖通过参数注入：cursorApi, tokenExchange, hasValidCredentials
 */

/**
 * 尝试刷新 acc 的 access_token + cookie
 * @param {object} acc - 账号对象（会被修改）
 * @param {object} update - 更新对象（会被修改）
 * @param {object} tokenExchange - tokenExchange 服务
 * @returns {Promise<boolean>} 是否刷新成功
 */
export async function tryRefreshTokenAndCookie(acc, update, tokenExchange) {
  if (!acc.refresh_token) return { success: false, isAuthError: false };

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
    if (refreshResult.isAuthError) {
      acc._refreshInvalid = true;
    }
    return refreshResult;
  }

  acc.access_token = refreshResult.accessToken;
  update.access_token = refreshResult.accessToken;

  if (refreshResult.refreshToken && refreshResult.refreshToken !== acc.refresh_token) {
    acc.refresh_token = refreshResult.refreshToken;
    update.refresh_token = refreshResult.refreshToken;
  }

  if (refreshResult.newCookie) {
    acc.token = refreshResult.newCookie;
    update.token = refreshResult.newCookie;
  }

  return { success: true };
}

/**
 * 检查单个账号的 token 有效性和用量
 * @param {object} acc - 账号对象
 * @param {object} deps - 依赖注入 { cursorApi, tokenExchange, hasValidCredentials }
 * @returns {Promise<object>} update 对象
 */
export async function checkSingleAccount(acc, { cursorApi, tokenExchange, hasValidCredentials }) {
  const update = { email: acc.email };

  // 跳过已禁用的账号
  if (acc.account_status === "disabled") {
    return update;
  }

  if (!acc.token && !acc.access_token && !acc.refresh_token) {
    update.token_valid = 0;
    update.account_status = acc.account_status === "new" ? "new" : "failed";
    update.last_checked = new Date().toISOString();
    return update;
  }

  // 如果有 refresh_token 但没有有效的 access_token，提前尝试刷新
  if (!acc.access_token && acc.refresh_token) {
    await tryRefreshTokenAndCookie(acc, update, tokenExchange);
  }

  // 调 API 查用量和订阅
  let usage = await cursorApi.fetchUsageSmart(acc);
  let stripe = await cursorApi.fetchStripeSmart(acc);

  // 如果 401/403/307，尝试挽救（刷新或用 cookie 兑换）
  let refreshAttemptedAndAuthFailed = false;
  
  if (usage.status === 401 || usage.status === 403 || usage.status === 307) {
    let refreshed = false;

    if (acc.refresh_token) {
      const res = await tryRefreshTokenAndCookie(acc, update, tokenExchange);
      if (res.success) {
        refreshed = true;
      } else if (res.isAuthError) {
        // refresh_token 死了（真正的Auth失败），尝试用 cookie 兜底挽救！
        if (acc.token) {
          console.log(`[check] ${acc.email}: refresh_token 失效，尝试用 cookie 兜底挽救...`);
          const exchangeResult = await tokenExchange.exchangeCookieToTokens(acc.token);
          if (exchangeResult.success) {
            acc.access_token = exchangeResult.accessToken;
            acc.refresh_token = exchangeResult.refreshToken;
            update.access_token = exchangeResult.accessToken;
            update.refresh_token = exchangeResult.refreshToken;
            refreshed = true;
          } else {
            // cookie 也罢工了，彻底死透
            refreshAttemptedAndAuthFailed = true;
          }
        } else {
          refreshAttemptedAndAuthFailed = true;
        }
      }
    } else if (acc.token) {
      const exchangeResult = await tokenExchange.exchangeCookieToTokens(acc.token);
      if (exchangeResult.success) {
        acc.access_token = exchangeResult.accessToken;
        acc.refresh_token = exchangeResult.refreshToken;
        update.access_token = exchangeResult.accessToken;
        update.refresh_token = exchangeResult.refreshToken;
        refreshed = true;
      } else {
        // cookie 兑换失败通常意味着 cookie 也彻底或者部分失效 (登录界面/超时等)
        // 保守起见将其视为 auth 失败。
        refreshAttemptedAndAuthFailed = true;
      }
    }

    if (refreshed) {
      usage = await cursorApi.fetchUsageSmart(acc);
      stripe = await cursorApi.fetchStripeSmart(acc);
    } else {
      // 如果尝试时都没有 refresh_token 和 cookie 可用，说明在 401 面前已经束手无策，判定为 auth 失败（死透了）
      if (!acc.refresh_token && !acc.token) {
        refreshAttemptedAndAuthFailed = true;
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
  } else if (usage.status === 401 || usage.status === 403 || usage.status === 307) {
    if (refreshAttemptedAndAuthFailed) {
      update.token_valid = 0;
      update.account_status = acc.account_status === "new" ? "new" : (acc.account_status === "disabled" ? "disabled" : "failed");
    }
    // else { 
    //    遇到了纯网络错误，没能完成重试。为了账号不被误杀，什么标记也不做，留到下次巡检
    // }
  } else {
    if (usage.error === "no_token") {
      update.token_valid = 0;
      update.account_status = acc.account_status === "new" ? "new" : (acc.account_status === "disabled" ? "disabled" : "failed");
    }
    // 网络错误等保持原状
  }

  if (stripe.status === 200 && stripe.data) {
    update.membership_type = stripe.data.membershipType || update.membership_type;
    update.days_remaining = stripe.data.daysRemainingOnTrial || 0;
    if (stripe.data.paymentId) update.stripe_customer_id = stripe.data.paymentId;
    if (stripe.data.teamId) update.team_id = String(stripe.data.teamId);
  }

  update.last_checked = new Date().toISOString();
  return update;
}
