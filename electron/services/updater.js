/**
 * 自动更新服务
 * 使用 electron-updater 从 GitHub Releases 检测并下载新版本
 *
 * macOS 说明：Squirrel.Mac 在安装 zip 更新时会校验「当前 App」与「新版本」的代码签名是否一致。
 * CI 使用 ad-hoc 签名（codesign -），每次构建签名都不同，自动安装必然失败（SQRLCodeSignatureErrorDomain）。
 * `verifyUpdateCodeSignature` 仅作用于 Windows NSIS，对 mac 无效。
 * 因此打包后的 mac 客户端只「检查版本」，不自动下载 zip；请用户从 Release 下载 DMG 覆盖安装。
 */
import pkg from "electron-updater";
const { autoUpdater } = pkg;
import { app } from "electron";
import { releaseTagUrl } from "./github-release-url.js";

export { releaseTagUrl };

let _sendToRenderer = null;
let _initialized = false;
let _checkTimer = null;

/** 打包后的 mac：只做版本检查，避免下载后因签名失败浪费流量且误导用户 */
let _macManualReleaseOnly = false;

function init(sendToRenderer) {
  _sendToRenderer = sendToRenderer;

  if (_initialized) return;
  _initialized = true;

  autoUpdater.setFeedURL({
    provider: "github",
    owner: "yifancao9211",
    repo: "cursor-auto-login",
  });

  _macManualReleaseOnly = process.platform === "darwin" && app.isPackaged;

  // 配置
  if (_macManualReleaseOnly) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
  } else {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
  }

  // 仅 Windows NSIS 安装包会用到；mac 不走此选项
  if (process.platform === "win32") {
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
    send("available", {
      version: info.version,
      releaseDate: info.releaseDate,
      manualDownload: _macManualReleaseOnly,
    });
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
    let message = err.message;
    if (
      typeof message === "string" &&
      (message.includes("SQRLCodeSignatureErrorDomain") ||
        message.includes("code failed to satisfy specified code requirement"))
    ) {
      message =
        "macOS 自动更新需要 Apple 开发者证书签名；当前构建为 ad-hoc 签名，请从 GitHub Release 下载 DMG 手动安装。";
    }
    send("error", { message, manualDownload: _macManualReleaseOnly });
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
  if (_macManualReleaseOnly) {
    console.warn("[updater] macOS 当前为手动安装模式，请从 GitHub Release 下载 DMG");
    return { skipped: true, reason: "mac-manual-release" };
  }
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
  releaseTagUrl,
  isMacManualReleaseOnly: () => _macManualReleaseOnly,
};
