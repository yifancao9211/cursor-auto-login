import { describe, it, expect } from "vitest";
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

  it("builds Feishu card with colored header", () => {
    const { buildFeishuCard } = require("../electron/services/webhook.js");
    const payload = formatWebhookPayload(WEBHOOK_EVENTS.QUOTA_EXHAUSTED, { email: "test@t.com", balance: 0 });
    const card = buildFeishuCard(payload);
    expect(card.header.template).toBe("orange");
    expect(card.header.title.content).toContain("⚠️");
    expect(card.elements.length).toBeGreaterThan(0);
  });

  it("builds Feishu auto_check_done card with stat columns and health score", () => {
    const { buildFeishuCard } = require("../electron/services/webhook.js");
    const payload = formatWebhookPayload(WEBHOOK_EVENTS.AUTO_CHECK_DONE, { total: 67, success: 65, failed: 2, healthScore: 92, healthGrade: "A" });
    const card = buildFeishuCard(payload);
    expect(card.header.template).toBe("blue");
    const columnSet = card.elements.find(e => e.tag === "column_set");
    expect(columnSet).toBeDefined();
    expect(columnSet.columns).toHaveLength(3);
    const healthMd = card.elements.find(e => e.tag === "column_set" && JSON.stringify(e).includes("健康度"));
    expect(healthMd).toBeDefined();
  });

  it("builds Feishu token_expired card with email list", () => {
    const { buildFeishuCard } = require("../electron/services/webhook.js");
    const payload = formatWebhookPayload(WEBHOOK_EVENTS.TOKEN_BATCH_EXPIRED, {
      count: 3, emails: ["a@t.com", "b@t.com", "c@t.com"]
    });
    const card = buildFeishuCard(payload);
    expect(card.header.template).toBe("red");
    const md = card.elements.find(e => e.tag === "markdown");
    expect(md.content).toContain("a@t.com");
  });

  it("builds Feishu all_exhausted card with urgency message", () => {
    const { buildFeishuCard } = require("../electron/services/webhook.js");
    const payload = formatWebhookPayload(WEBHOOK_EVENTS.ALL_EXHAUSTED, { totalAccounts: 20 });
    const card = buildFeishuCard(payload);
    expect(card.header.template).toBe("red");
    const urgent = card.elements.find(e => e.tag === "markdown" && e.content?.includes("尽快"));
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
