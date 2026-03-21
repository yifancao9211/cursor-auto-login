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

export function formatWebhookPayload(event, data = {}) {
  return {
    event,
    label: EVENT_LABELS[event] || event,
    data,
    timestamp: new Date().toISOString(),
    source: "Cursor Account Manager",
  };
}

export function buildDiscordEmbed(payload) {
  const colorMap = {
    [WEBHOOK_EVENTS.QUOTA_EXHAUSTED]: 0xff9500,
    [WEBHOOK_EVENTS.ALL_EXHAUSTED]: 0xff3b30,
    [WEBHOOK_EVENTS.TOKEN_BATCH_EXPIRED]: 0xff3b30,
    [WEBHOOK_EVENTS.NEW_MEMBERS]: 0x34c759,
    [WEBHOOK_EVENTS.AUTO_CHECK_DONE]: 0x007aff,
  };
  const fields = Object.entries(payload.data).map(([k, v]) => ({
    name: k,
    value: String(v),
    inline: true,
  }));
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

export function buildFeishuCard(payload) {
  const color = FEISHU_COLORS[payload.event] || "blue";
  const icon = FEISHU_ICONS[payload.event] || "🔔";
  const elements = [];

  if (payload.event === WEBHOOK_EVENTS.AUTO_CHECK_DONE) {
    const d = payload.data;
    elements.push({
      tag: "column_set",
      flex_mode: "none",
      background_style: "default",
      columns: [
        feishuStatColumn("总计", String(d.total || 0), "green"),
        feishuStatColumn("成功", String(d.success || 0), "blue"),
        feishuStatColumn("失败", String(d.failed || 0), d.failed > 0 ? "red" : "grey"),
      ],
    });
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
    msg_type: "interactive",
    card: {
      header: {
        template: color,
        title: { tag: "plain_text", content: `${icon} ${payload.label}` },
      },
      elements,
    },
  };
}

function feishuStatColumn(label, value, color = "grey") {
  return {
    tag: "column",
    width: "weighted",
    weight: 1,
    elements: [
      { tag: "markdown", content: `<font color="${color}">**${value}**</font>`, text_align: "center" },
      { tag: "markdown", content: `<font color="grey">${label}</font>`, text_align: "center" },
    ],
  };
}

export function buildWeComMessage(payload) {
  const lines = Object.entries(payload.data).map(([k, v]) => `> **${k}**: ${v}`).join("\n");
  return {
    msgtype: "markdown",
    markdown: {
      content: `## 🔔 ${payload.label}\n${lines}\n\n<font color="comment">${payload.source} · ${new Date(payload.timestamp).toLocaleString()}</font>`,
    },
  };
}

export async function sendWebhook(url, body) {
  if (!url) return { success: false, error: "no_url" };
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) },
    }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ success: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode }));
    });
    req.on("error", (e) => resolve({ success: false, error: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ success: false, error: "timeout" }); });
    req.write(data);
    req.end();
  });
}

export async function dispatchWebhook(settings, event, data) {
  if (!settings?.webhookEnabled || !settings?.webhookUrl) return;
  const payload = formatWebhookPayload(event, data);
  const type = settings.webhookType || "discord";
  let body;
  if (type === "feishu") body = buildFeishuCard(payload);
  else if (type === "wecom") body = buildWeComMessage(payload);
  else body = buildDiscordEmbed(payload);

  const result = await sendWebhook(settings.webhookUrl, body);
  if (!result.success) console.error(`[webhook] Failed to send ${event}:`, result.error || result.status);
  return result;
}
