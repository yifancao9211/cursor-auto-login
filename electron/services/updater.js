/**
 * 自动更新服务
 * 使用 electron-updater 从 GitHub Releases 检测并下载新版本
 */
import pkg from "electron-updater";
const { autoUpdater } = pkg;
import { app } from "electron";

let _sendToRenderer = null;
let _initialized = false;
let _checkTimer = null;

function init(sendToRenderer) {
  _sendToRenderer = sendToRenderer;

  if (_initialized) return;
  _initialized = true;

  autoUpdater.setFeedURL({
    provider: "github",
    owner: "yifancao9211",
    repo: "cursor-auto-login",
  });

  // 配置
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // macOS: 跳过代码签名验证（ad-hoc 签名无法通过 Gatekeeper 的更新验证）
  if (process.platform === "darwin") {
    autoUpdater.verifyUpdateCodeSignature = false;
  }

  // 日志
  autoUpdater.logger = {
    info: (...args) => console.log("[updater]", ...args),
    warn: (...args) => console.warn("[updater]", ...args),
    error: (...args) => console.error("[updater]", ...args),
  };

  // 事件绑定
  autoUpdater.on("checking-for-update", () => {
    send("checking");
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[updater] 发现新版本:", info.version);
    send("available", { version: info.version, releaseDate: info.releaseDate });
  });

  autoUpdater.on("update-not-available", (info) => {
    console.log("[updater] 已是最新版本:", info.version);
    send("not-available", { version: info.version });
  });

  autoUpdater.on("download-progress", (progress) => {
    send("downloading", {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      speed: progress.bytesPerSecond,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("[updater] 更新已下载:", info.version);
    send("downloaded", { version: info.version });
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater] 错误:", err.message);
    send("error", { message: err.message });
  });

  if (!isDev()) {
    setTimeout(() => checkForUpdates(), 10000);
    _checkTimer = setInterval(() => checkForUpdates(), 60 * 60 * 1000);
  }
}

function send(status, data = {}) {
  if (_sendToRenderer) {
    _sendToRenderer("update:status", { status, ...data });
  }
}

function isDev() {
  return !app.isPackaged;
}

async function checkForUpdates() {
  if (isDev()) {
    console.log("[updater] 开发模式，跳过更新检查");
    return { status: "dev-mode" };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return result;
  } catch (err) {
    console.error("[updater] 检查失败:", err.message);
    return { error: err.message };
  }
}

function installUpdate() {
  autoUpdater.quitAndInstall(false, true);
}

function getVersion() {
  return app.getVersion();
}

export const updater = {
  init,
  checkForUpdates,
  installUpdate,
  getVersion,
};
