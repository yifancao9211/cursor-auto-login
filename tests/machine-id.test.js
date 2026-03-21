import { describe, it, expect } from "vitest";
import crypto from "node:crypto";

// Test the pure generation logic without Electron dependencies
function generate(currentIds = {}) {
  return {
    machineId: crypto.randomBytes(32).toString("hex"),
    macMachineId: crypto.randomBytes(32).toString("hex"),
    devDeviceId: crypto.randomUUID(),
    sqmId: currentIds.sqmId ? `{${crypto.randomUUID().toUpperCase()}}` : "",
  };
}

describe("machineIdService.generate", () => {
  it("produces 64-char hex machineId and macMachineId", () => {
    const ids = generate();
    expect(ids.machineId).toMatch(/^[0-9a-f]{64}$/);
    expect(ids.macMachineId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces valid UUID for devDeviceId", () => {
    const ids = generate();
    expect(ids.devDeviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("generates sqmId when currentIds has sqmId", () => {
    const ids = generate({ sqmId: "{OLD-UUID}" });
    expect(ids.sqmId).toMatch(/^\{[0-9A-F-]+\}$/);
    expect(ids.sqmId).not.toBe("{OLD-UUID}");
  });

  it("leaves sqmId empty when currentIds has no sqmId", () => {
    const ids = generate({});
    expect(ids.sqmId).toBe("");
  });

  it("generates unique values each call", () => {
    const a = generate();
    const b = generate();
    expect(a.machineId).not.toBe(b.machineId);
    expect(a.macMachineId).not.toBe(b.macMachineId);
    expect(a.devDeviceId).not.toBe(b.devDeviceId);
  });
});
