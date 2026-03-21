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

  it("builds Feishu auto_check_done card with rich data", () => {
    const { buildFeishuCard } = require("../electron/services/webhook.js");
    const payload = formatWebhookPayload(WEBHOOK_EVENTS.AUTO_CHECK_DONE, {
      total: 68, success: 68, failed: 0, healthScore: 92, healthGrade: "A",
      tokenH: 100, balH: 85, covH: 100, activeCount: 67, withBalanceCount: 50,
      totalBalance: 245.5, newCount: 0, failedCount: 1, currentEmail: "test@t.com",
    });
    const card = buildFeishuCard(payload);
    expect(card.header.template).toBe("blue");
    const json = JSON.stringify(card);
    expect(json).toContain("健康度");
    expect(json).toContain("$245.5");
    expect(json).toContain("test");
    const statCols = card.elements.find(e => e.tag === "column_set" && e.columns?.length === 4);
    expect(statCols).toBeDefined();
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
