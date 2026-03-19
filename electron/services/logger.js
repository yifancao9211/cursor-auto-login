import util from "node:util";

const MAX_ENTRIES = 2000;

class Logger {
  constructor() {
    this.enabled = false;
    this.entries = [];
    this._sendToRenderer = null;
    this._originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };
  }

  /**
   * @param {function} sendToRenderer - (channel, data) => void
   */
  init(sendToRenderer) {
    this._sendToRenderer = sendToRenderer;
    this._overrideConsole();
    this._originalConsole.log("[logger] Initialized (in-app mode)");
  }

  setEnabled(enabled) {
    const wasEnabled = this.enabled;
    this.enabled = enabled;
    if (enabled && !wasEnabled) {
      this._push("info", "[logger] 日志记录已开启", "main");
    } else if (!enabled && wasEnabled) {
      this._push("info", "[logger] 日志记录已关闭", "main");
    }
  }

  /** Accept a log line from the renderer process */
  addRendererLog(level, message) {
    if (!this.enabled) return;
    this._push(level, message, "renderer");
  }

  getAll() {
    return this.entries;
  }

  clear() {
    this.entries = [];
    this._sendToRenderer?.("logger:cleared", {});
    this._originalConsole.log("[logger] Logs cleared");
  }

  _push(level, message, source = "main") {
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg: message,
      source,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    this._sendToRenderer?.("logger:entry", entry);
  }

  _overrideConsole() {
    console.log = (...args) => {
      this._originalConsole.log(...args);
      if (this.enabled) this._push("info", util.format(...args), "main");
    };

    console.warn = (...args) => {
      this._originalConsole.warn(...args);
      if (this.enabled) this._push("warn", util.format(...args), "main");
    };

    console.error = (...args) => {
      this._originalConsole.error(...args);
      if (this.enabled) this._push("error", util.format(...args), "main");
    };
  }
}

export const logger = new Logger();
