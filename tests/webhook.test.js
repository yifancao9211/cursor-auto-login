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

  it("builds Feishu card format", () => {
    const { buildFeishuCard } = require("../electron/services/webhook.js");
    const payload = formatWebhookPayload(WEBHOOK_EVENTS.QUOTA_EXHAUSTED, { email: "test@t.com" });
    const card = buildFeishuCard(payload);
    expect(card.msg_type).toBe("interactive");
  });

  it("builds WeCom markdown format", () => {
    const { buildWeComMessage } = require("../electron/services/webhook.js");
    const payload = formatWebhookPayload(WEBHOOK_EVENTS.NEW_MEMBERS, { count: 3, team: "Dev" });
    const msg = buildWeComMessage(payload);
    expect(msg.msgtype).toBe("markdown");
    expect(msg.markdown.content).toContain("3");
  });
});
