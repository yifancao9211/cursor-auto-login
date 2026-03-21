import { describe, it, expect, vi } from "vitest";
import { formatWebhookPayload, WEBHOOK_EVENTS } from "../electron/services/webhook.js";

describe("formatWebhookPayload", () => {
  it("formats quota_exhausted event", () => {
    const payload = formatWebhookPayload(WEBHOOK_EVENTS.QUOTA_EXHAUSTED, {
      email: "test@example.com",
      balance: 0,
    });
    expect(payload.event).toBe("quota_exhausted");
    expect(payload.data.email).toBe("test@example.com");
    expect(payload.timestamp).toBeDefined();
  });

  it("formats token_expired event with account count", () => {
    const payload = formatWebhookPayload(WEBHOOK_EVENTS.TOKEN_BATCH_EXPIRED, {
      count: 5,
      emails: ["a@t.com", "b@t.com"],
    });
    expect(payload.event).toBe("token_batch_expired");
    expect(payload.data.count).toBe(5);
  });

  it("formats new_members_discovered event", () => {
    const payload = formatWebhookPayload(WEBHOOK_EVENTS.NEW_MEMBERS, {
      count: 3,
      team: "Engineering",
    });
    expect(payload.event).toBe("new_members_discovered");
    expect(payload.data.team).toBe("Engineering");
  });

  it("formats all_exhausted event", () => {
    const payload = formatWebhookPayload(WEBHOOK_EVENTS.ALL_EXHAUSTED, {
      totalAccounts: 20,
    });
    expect(payload.event).toBe("all_accounts_exhausted");
    expect(payload.data.totalAccounts).toBe(20);
  });

  it("builds Discord embed format", () => {
    const { buildDiscordEmbed } = require("../electron/services/webhook.js");
    const payload = formatWebhookPayload(WEBHOOK_EVENTS.QUOTA_EXHAUSTED, { email: "test@t.com", balance: 0 });
    const embed = buildDiscordEmbed(payload);
    expect(embed.embeds).toHaveLength(1);
    expect(embed.embeds[0].title).toContain("Cursor");
  });

  it("builds Feishu interactive card with colored header", () => {
    const { buildFeishuCard } = require("../electron/services/webhook.js");
    const payload = formatWebhookPayload(WEBHOOK_EVENTS.QUOTA_EXHAUSTED, { email: "test@t.com", balance: 0 });
    const card = buildFeishuCard(payload);
    expect(card.msg_type).toBe("interactive");
    expect(card.card.header.template).toBe("orange");
    expect(card.card.header.title.content).toContain("⚠️");
  });

  it("builds Feishu auto_check_done card with stat columns", () => {
    const { buildFeishuCard } = require("../electron/services/webhook.js");
    const payload = formatWebhookPayload(WEBHOOK_EVENTS.AUTO_CHECK_DONE, { total: 67, success: 65, failed: 2 });
    const card = buildFeishuCard(payload);
    expect(card.card.header.template).toBe("blue");
    const columnSet = card.card.elements.find(e => e.tag === "column_set");
    expect(columnSet).toBeDefined();
    expect(columnSet.columns).toHaveLength(3);
  });

  it("builds Feishu token_expired card with email list", () => {
    const { buildFeishuCard } = require("../electron/services/webhook.js");
    const payload = formatWebhookPayload(WEBHOOK_EVENTS.TOKEN_BATCH_EXPIRED, {
      count: 3, emails: ["a@t.com", "b@t.com", "c@t.com"]
    });
    const card = buildFeishuCard(payload);
    expect(card.card.header.template).toBe("red");
    const md = card.card.elements.find(e => e.tag === "markdown");
    expect(md.content).toContain("a@t.com");
  });

  it("builds Feishu all_exhausted card with urgency message", () => {
    const { buildFeishuCard } = require("../electron/services/webhook.js");
    const payload = formatWebhookPayload(WEBHOOK_EVENTS.ALL_EXHAUSTED, { totalAccounts: 20 });
    const card = buildFeishuCard(payload);
    expect(card.card.header.template).toBe("red");
    const urgent = card.card.elements.find(e => e.tag === "markdown" && e.content?.includes("尽快"));
    expect(urgent).toBeDefined();
  });

  it("builds WeCom markdown format", () => {
    const { buildWeComMessage } = require("../electron/services/webhook.js");
    const payload = formatWebhookPayload(WEBHOOK_EVENTS.NEW_MEMBERS, { count: 3, team: "Dev" });
    const msg = buildWeComMessage(payload);
    expect(msg.msgtype).toBe("markdown");
    expect(msg.markdown.content).toContain("3");
  });
});
