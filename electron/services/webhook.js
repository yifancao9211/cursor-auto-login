import https from "node:https";

export const WEBHOOK_EVENTS = {
  QUOTA_EXHAUSTED: "quota_exhausted",
  TOKEN_BATCH_EXPIRED: "token_batch_expired",
  NEW_MEMBERS: "new_members_discovered",
  ALL_EXHAUSTED: "all_accounts_exhausted",
  AUTO_CHECK_DONE: "auto_check_done",
};

const EVENT_LABELS = {
  [WEBHOOK_EVENTS.QUOTA_EXHAUSTED]: "账号配额耗尽",
  [WEBHOOK_EVENTS.TOKEN_BATCH_EXPIRED]: "Token 批量过期",
  [WEBHOOK_EVENTS.NEW_MEMBERS]: "发现新成员",
  [WEBHOOK_EVENTS.ALL_EXHAUSTED]: "全部账号余额耗尽",
  [WEBHOOK_EVENTS.AUTO_CHECK_DONE]: "自动巡检完成",
};

// ==================== Payload ====================

export function formatWebhookPayload(event, data = {}) {
  return {
    event,
    label: EVENT_LABELS[event] || event,
    data,
    timestamp: new Date().toISOString(),
    source: "Cursor Account Manager",
  };
}

// ==================== Discord ====================

export function buildDiscordEmbed(payload) {
  const colorMap = {
    [WEBHOOK_EVENTS.QUOTA_EXHAUSTED]: 0xff9500,
    [WEBHOOK_EVENTS.ALL_EXHAUSTED]: 0xff3b30,
    [WEBHOOK_EVENTS.TOKEN_BATCH_EXPIRED]: 0xff3b30,
    [WEBHOOK_EVENTS.NEW_MEMBERS]: 0x34c759,
    [WEBHOOK_EVENTS.AUTO_CHECK_DONE]: 0x007aff,
  };
  const fields = Object.entries(payload.data).map(([k, v]) => ({ name: k, value: String(v), inline: true }));
  return {
    embeds: [{
      title: `🔔 Cursor Manager — ${payload.label}`,
      color: colorMap[payload.event] || 0x007aff,
      fields,
      timestamp: payload.timestamp,
      footer: { text: payload.source },
    }],
  };
}

// ==================== 飞书 Interactive Card ====================

const FEISHU_COLORS = {
  [WEBHOOK_EVENTS.QUOTA_EXHAUSTED]: "orange",
  [WEBHOOK_EVENTS.ALL_EXHAUSTED]: "red",
  [WEBHOOK_EVENTS.TOKEN_BATCH_EXPIRED]: "red",
  [WEBHOOK_EVENTS.NEW_MEMBERS]: "green",
  [WEBHOOK_EVENTS.AUTO_CHECK_DONE]: "blue",
};

const FEISHU_ICONS = {
  [WEBHOOK_EVENTS.QUOTA_EXHAUSTED]: "⚠️",
  [WEBHOOK_EVENTS.ALL_EXHAUSTED]: "🚨",
  [WEBHOOK_EVENTS.TOKEN_BATCH_EXPIRED]: "🔑",
  [WEBHOOK_EVENTS.NEW_MEMBERS]: "👥",
  [WEBHOOK_EVENTS.AUTO_CHECK_DONE]: "✅",
};

function feishuStatColumn(label, value, color = "grey") {
  return {
    tag: "column", width: "weighted", weight: 1,
    elements: [
      { tag: "markdown", content: `<font color="${color}">**${value}**</font>`, text_align: "center" },
      { tag: "markdown", content: `<font color="grey">${label}</font>`, text_align: "center" },
    ],
  };
}

export function buildFeishuCard(payload) {
  const color = FEISHU_COLORS[payload.event] || "blue";
  const icon = FEISHU_ICONS[payload.event] || "🔔";
  const elements = [];

  if (payload.event === WEBHOOK_EVENTS.AUTO_CHECK_DONE) {
    const d = payload.data;
    const hColor = d.healthScore >= 90 ? "green" : d.healthScore >= 60 ? "orange" : "red";

    // Row 1: Health score banner
    if (d.healthScore != null) {
      elements.push({
        tag: "column_set", flex_mode: "none",
        columns: [
          { tag: "column", width: "weighted", weight: 1, elements: [
            { tag: "markdown", content: `🏥 健康度 <font color="${hColor}">**${d.healthGrade} (${d.healthScore}/100)**</font>` },
          ]},
          { tag: "column", width: "weighted", weight: 1, elements: [
            { tag: "markdown", content: `👤 当前: **${d.currentEmail ? d.currentEmail.split("@")[0] : "-"}**`, text_align: "right" },
          ]},
        ],
      });
      elements.push({ tag: "hr" });
    }

    // Row 2: Account stats
    elements.push({
      tag: "column_set", flex_mode: "none", background_style: "default",
      columns: [
        feishuStatColumn("总账号", String(d.total || 0), "green"),
        feishuStatColumn("活跃", String(d.activeCount || 0), "blue"),
        feishuStatColumn("有余额", String(d.withBalanceCount || 0), "green"),
        feishuStatColumn("失败", String(d.failedCount || 0), d.failedCount > 0 ? "red" : "grey"),
      ],
    });

    // Row 3: Balance + dimension breakdown
    elements.push({ tag: "hr" });
    elements.push({
      tag: "column_set", flex_mode: "none",
      columns: [
        { tag: "column", width: "weighted", weight: 1, elements: [
          { tag: "markdown", content: `💰 **总可用余额**\n<font color="green">**$${d.totalBalance || 0}**</font>` },
        ]},
        { tag: "column", width: "weighted", weight: 1, elements: [
          { tag: "markdown", content: `🔑 Token ${d.tokenH || 0}%\n💰 余额 ${d.balH || 0}%\n📊 覆盖 ${d.covH || 0}%` },
        ]},
      ],
    });

    // Row 4: Check results
    if (d.newCount > 0 || d.failed > 0) {
      elements.push({ tag: "hr" });
      const alerts = [];
      if (d.newCount > 0) alerts.push(`🆕 ${d.newCount} 个待登录`);
      if (d.failed > 0) alerts.push(`<font color="red">❌ ${d.failed} 个检查失败</font>`);
      elements.push({ tag: "markdown", content: alerts.join("  ·  ") });
    }
  } else if (payload.event === WEBHOOK_EVENTS.QUOTA_EXHAUSTED || payload.event === WEBHOOK_EVENTS.ALL_EXHAUSTED) {
    const d = payload.data;
    elements.push({ tag: "markdown", content: `**账号**: ${d.email || "全部"}\n**余额**: $${d.balance ?? 0}\n**总账号数**: ${d.totalAccounts || "-"}` });
    elements.push({ tag: "hr" });
    elements.push({ tag: "markdown", content: `<font color="red">请尽快处理，当前已无可用配额。</font>` });
  } else if (payload.event === WEBHOOK_EVENTS.TOKEN_BATCH_EXPIRED) {
    const d = payload.data;
    const emailList = (d.emails || []).slice(0, 5).join("\n• ");
    elements.push({ tag: "markdown", content: `**过期数量**: ${d.count}\n\n• ${emailList}${d.count > 5 ? `\n\n...及其他 ${d.count - 5} 个` : ""}` });
  } else if (payload.event === WEBHOOK_EVENTS.NEW_MEMBERS) {
    elements.push({ tag: "markdown", content: `**团队**: ${payload.data.team || "-"}\n**新成员数**: ${payload.data.count}` });
  } else {
    const lines = Object.entries(payload.data).map(([k, v]) => `**${k}**: ${v}`).join("\n");
    elements.push({ tag: "markdown", content: lines || "无附加信息" });
  }

  elements.push({
    tag: "note",
    elements: [{ tag: "plain_text", content: `${payload.source} · ${new Date(payload.timestamp).toLocaleString("zh-CN")}` }],
  });

  return {
    header: { template: color, title: { tag: "plain_text", content: `${icon} ${payload.label}` } },
    elements,
  };
}

// ==================== 企业微信 ====================

export function buildWeComMessage(payload) {
  const lines = Object.entries(payload.data).map(([k, v]) => `> **${k}**: ${v}`).join("\n");
  return {
    msgtype: "markdown",
    markdown: {
      content: `## 🔔 ${payload.label}\n${lines}\n\n<font color="comment">${payload.source} · ${new Date(payload.timestamp).toLocaleString()}</font>`,
    },
  };
}

// ==================== HTTP helpers ====================

function httpPost(hostname, path, body, headers = {}) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname, path, method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), ...headers },
    }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        try { resolve(JSON.parse(buf)); } catch { resolve({ raw: buf, statusCode: res.statusCode }); }
      });
    });
    req.on("error", (e) => resolve({ success: false, error: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ success: false, error: "timeout" }); });
    req.write(data);
    req.end();
  });
}

// ==================== 飞书 App API (app_id + app_secret) ====================

let _feishuTokenCache = { token: null, expiresAt: 0 };

async function getFeishuTenantToken(appId, appSecret) {
  if (_feishuTokenCache.token && Date.now() < _feishuTokenCache.expiresAt) {
    return _feishuTokenCache.token;
  }
  const resp = await httpPost("open.feishu.cn", "/open-apis/auth/v3/tenant_access_token/internal", {
    app_id: appId, app_secret: appSecret,
  });
  if (resp.code !== 0 || !resp.tenant_access_token) {
    console.error("[feishu] Failed to get tenant_access_token:", resp);
    return null;
  }
  _feishuTokenCache = {
    token: resp.tenant_access_token,
    expiresAt: Date.now() + (resp.expire - 300) * 1000, // refresh 5 min early
  };
  return resp.tenant_access_token;
}

export async function feishuListChats(appId, appSecret) {
  const token = await getFeishuTenantToken(appId, appSecret);
  if (!token) return [];
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "open.feishu.cn",
      path: "/open-apis/im/v1/chats?page_size=50",
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        try {
          const data = JSON.parse(buf);
          resolve((data.data?.items || []).map((c) => ({ id: c.chat_id, name: c.name })));
        } catch { resolve([]); }
      });
    });
    req.on("error", () => resolve([]));
    req.end();
  });
}

async function sendFeishuAppMessage(appId, appSecret, receiveId, card) {
  const token = await getFeishuTenantToken(appId, appSecret);
  if (!token) return { success: false, error: "no_token" };
  const idType = receiveId.startsWith("ou_") ? "open_id" : "chat_id";
  const resp = await httpPost(
    "open.feishu.cn",
    `/open-apis/im/v1/messages?receive_id_type=${idType}`,
    { receive_id: receiveId, msg_type: "interactive", content: JSON.stringify(card) },
    { Authorization: `Bearer ${token}` },
  );
  if (resp.code === 0) return { success: true, messageId: resp.data?.message_id };
  return { success: false, error: `${resp.code}: ${resp.msg}` };
}

// ==================== 统一简单 Webhook POST ====================

async function sendSimpleWebhook(url, body) {
  if (!url) return { success: false, error: "no_url" };
  const u = new URL(url);
  const resp = await httpPost(u.hostname, u.pathname + u.search, body);
  const ok = resp.statusCode ? resp.statusCode >= 200 && resp.statusCode < 300 : resp.code === 0;
  return { success: ok, status: resp.statusCode, code: resp.code };
}

// ==================== Dispatch (统一入口) ====================

export async function dispatchWebhook(settings, event, data) {
  if (!settings?.webhookEnabled) return;
  const payload = formatWebhookPayload(event, data);
  const type = settings.webhookType || "discord";

  let result;
  if (type === "feishu_app" && settings.feishuAppId && settings.feishuAppSecret && settings.feishuChatId) {
    const card = buildFeishuCard(payload);
    result = await sendFeishuAppMessage(settings.feishuAppId, settings.feishuAppSecret, settings.feishuChatId, card);
  } else if (type === "feishu" && settings.webhookUrl) {
    const card = buildFeishuCard(payload);
    result = await sendSimpleWebhook(settings.webhookUrl, { msg_type: "interactive", card });
  } else if (type === "wecom" && settings.webhookUrl) {
    result = await sendSimpleWebhook(settings.webhookUrl, buildWeComMessage(payload));
  } else if (type === "discord" && settings.webhookUrl) {
    result = await sendSimpleWebhook(settings.webhookUrl, buildDiscordEmbed(payload));
  } else {
    return { success: false, error: "invalid_config" };
  }

  if (!result?.success) console.error(`[webhook] Failed to send ${event}:`, result?.error || result?.status);
  return result;
}
