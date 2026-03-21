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

export function buildFeishuCard(payload) {
  const lines = Object.entries(payload.data).map(([k, v]) => `**${k}**: ${v}`).join("\n");
  return {
    msg_type: "interactive",
    card: {
      header: { title: { tag: "plain_text", content: `🔔 ${payload.label}` } },
      elements: [
        { tag: "markdown", content: lines || "无附加信息" },
        { tag: "note", elements: [{ tag: "plain_text", content: `${payload.source} · ${payload.timestamp}` }] },
      ],
    },
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
