import { app } from "electron";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;

export function initUpdater(onEvent) {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // 手动配置更新地址，避免因为 CI 加上 --publish never 选项导致 app-update.yml 未生成的问题
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "yifancao9211",
    repo: "cursor-auto-login",
  });

  autoUpdater.on("checking-for-update", () => onEvent("checking"));
  autoUpdater.on("update-available", (info) => onEvent("available", info));
  autoUpdater.on("update-not-available", () => onEvent("not-available"));
  autoUpdater.on("download-progress", (p) => onEvent("progress", p));
  autoUpdater.on("update-downloaded", (info) => onEvent("downloaded", info));
  autoUpdater.on("error", (err) => onEvent("error", { message: err.message }));
}

export function checkForUpdates() {
  if (!app.isPackaged) return Promise.resolve(null);
  return autoUpdater.checkForUpdates();
}

export function quitAndInstall() {
  if (!app.isPackaged) return;
  autoUpdater.quitAndInstall();
}
