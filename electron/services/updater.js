import { app } from "electron";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;

export function initUpdater(onEvent) {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

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
