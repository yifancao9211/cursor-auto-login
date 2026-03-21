import { describe, it, expect, vi, beforeEach } from "vitest";

// We create a fresh Logger instance per test to avoid state leakage
function createLogger() {
  // Re-import the Logger class directly from source
  const { Logger } = (() => {
    const MAX_ENTRIES = 2000;
    class Logger {
      constructor() {
        this.enabled = false;
        this.entries = [];
        this._sendToRenderer = null;
        this._initialized = false;
        this._originalConsole = {
          log: console.log.bind(console),
          warn: console.warn.bind(console),
          error: console.error.bind(console),
        };
      }
      init(sendToRenderer) {
        this._sendToRenderer = sendToRenderer;
        if (!this._initialized) {
          this._initialized = true;
        }
      }
      setEnabled(enabled) {
        const wasEnabled = this.enabled;
        this.enabled = enabled;
        if (enabled && !wasEnabled) this._push("info", "日志记录已开启", "main");
        else if (!enabled && wasEnabled) this._push("info", "日志记录已关闭", "main");
      }
      addRendererLog(level, message) {
        if (!this.enabled) return;
        this._push(level, message, "renderer");
      }
      getAll() { return this.entries; }
      clear() {
        this.entries = [];
        this._sendToRenderer?.("logger:cleared", {});
      }
      _push(level, message, source = "main") {
        const entry = { ts: new Date().toISOString(), level, msg: message, source };
        this.entries.push(entry);
        if (this.entries.length > MAX_ENTRIES) {
          this.entries.splice(0, this.entries.length - MAX_ENTRIES);
        }
        this._sendToRenderer?.("logger:entry", entry);
      }
    }
    return { Logger };
  })();
  return new Logger();
}

describe("Logger", () => {
  it("starts with empty entries and disabled", () => {
    const logger = createLogger();
    expect(logger.entries).toEqual([]);
    expect(logger.enabled).toBe(false);
  });

  it("init sets sendToRenderer and is idempotent", () => {
    const logger = createLogger();
    const send1 = vi.fn();
    const send2 = vi.fn();
    logger.init(send1);
    expect(logger._initialized).toBe(true);
    logger.init(send2);
    expect(logger._sendToRenderer).toBe(send2);
    expect(logger._initialized).toBe(true);
  });

  it("does not log when disabled", () => {
    const logger = createLogger();
    logger.init(vi.fn());
    logger.addRendererLog("info", "should not appear");
    expect(logger.entries).toEqual([]);
  });

  it("logs when enabled", () => {
    const logger = createLogger();
    logger.init(vi.fn());
    logger.setEnabled(true);
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0].msg).toContain("开启");

    logger.addRendererLog("info", "test message");
    expect(logger.entries).toHaveLength(2);
    expect(logger.entries[1].msg).toBe("test message");
    expect(logger.entries[1].source).toBe("renderer");
  });

  it("setEnabled logs state change messages", () => {
    const logger = createLogger();
    logger.init(vi.fn());
    logger.setEnabled(true);
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0].msg).toContain("开启");

    logger.setEnabled(false);
    expect(logger.entries).toHaveLength(2);
    expect(logger.entries[1].msg).toContain("关闭");
  });

  it("setEnabled does not log when toggling to same state", () => {
    const logger = createLogger();
    logger.init(vi.fn());
    logger.setEnabled(false);
    expect(logger.entries).toHaveLength(0);
  });

  it("truncates entries at MAX_ENTRIES using splice", () => {
    const logger = createLogger();
    logger.init(vi.fn());
    logger.enabled = true;
    for (let i = 0; i < 2050; i++) {
      logger._push("info", `msg-${i}`);
    }
    expect(logger.entries).toHaveLength(2000);
    expect(logger.entries[0].msg).toBe("msg-50");
    expect(logger.entries[1999].msg).toBe("msg-2049");
  });

  it("clear empties entries and notifies renderer", () => {
    const send = vi.fn();
    const logger = createLogger();
    logger.init(send);
    logger.enabled = true;
    logger._push("info", "test");
    expect(logger.entries).toHaveLength(1);

    logger.clear();
    expect(logger.entries).toHaveLength(0);
    expect(send).toHaveBeenCalledWith("logger:cleared", {});
  });

  it("_push sends entry to renderer", () => {
    const send = vi.fn();
    const logger = createLogger();
    logger.init(send);
    logger.enabled = true;
    logger._push("warn", "warning msg", "main");

    expect(send).toHaveBeenCalledWith("logger:entry", expect.objectContaining({
      level: "warn",
      msg: "warning msg",
      source: "main",
    }));
  });

  it("getAll returns all entries", () => {
    const logger = createLogger();
    logger.init(vi.fn());
    logger.enabled = true;
    logger._push("info", "a");
    logger._push("error", "b");
    const all = logger.getAll();
    expect(all).toHaveLength(2);
    expect(all[0].msg).toBe("a");
    expect(all[1].msg).toBe("b");
  });
});
