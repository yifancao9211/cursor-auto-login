import { Tray, Menu, nativeImage, app } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray = null;

export const trayService = {
  init(mainWindow, { accountDb, onSmartSwitch, onRefresh, onSwitchAccount }) {
    if (tray) return;

    const iconPath = path.join(__dirname, "../assets/trayTemplate.png");
    let icon;
    try {
      if (!fs.existsSync(iconPath)) {
        console.error(`[tray] Icon not found at: ${iconPath}`);
      }
      // Electron 会自动在视网膜屏下寻找 trayTemplate@2x.png
      icon = nativeImage.createFromPath(iconPath);
      icon.setTemplateImage(true);
      if (icon.isEmpty()) {
        console.error(`[tray] Icon loaded but is empty: ${iconPath}`);
      }
    } catch (e) {
      console.error(`[tray] Failed to load icon: ${e.message}`);
      icon = nativeImage.createEmpty();
    }

    tray = new Tray(icon);
    tray.setToolTip("Cursor Account Manager");

    const isWindowAlive = () => mainWindow && !mainWindow.isDestroyed();

    const showAndFocus = () => {
      if (!isWindowAlive()) return;
      mainWindow.show();
      mainWindow.focus();
    };

    const updateMenu = () => {
      const accounts = accountDb.listAll().filter((a) => a.account_status !== "disabled");
      const active = accounts.filter((a) => a.token_valid);
      const withBalance = active.filter((a) => {
        const used = (a.plan_used || 0) + (a.on_demand_used || 0);
        const limit = (a.plan_limit || 0) + (a.on_demand_limit || 0);
        return limit > 0 && used < limit;
      });

      const top5 = withBalance
        .map((a) => {
          const bal = +((a.plan_limit || 0) + (a.on_demand_limit || 0) - (a.plan_used || 0) - (a.on_demand_used || 0)).toFixed(2);
          return { ...a, balance: bal };
        })
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 5);

      const accountItems = top5.map((a) => ({
        label: `${a.email.split("@")[0]}  $${a.balance}`,
        click: () => onSwitchAccount?.(a),
      }));

      const menu = Menu.buildFromTemplate([
        { label: `Active: ${active.length}/${accounts.length}  |  Balance: ${withBalance.length}`, enabled: false },
        { type: "separator" },
        ...accountItems,
        { type: "separator" },
        { label: "智能切号", click: () => onSmartSwitch?.() },
        { label: "刷新数据", click: () => onRefresh?.() },
        { type: "separator" },
        { label: "显示窗口", click: showAndFocus },
        { label: "退出", click: () => app.quit() },
      ]);

      tray.setContextMenu(menu);
      tray.setToolTip(`Cursor Manager — ${withBalance.length} 个有余额`);
    };

    tray.on("click", () => {
      if (!isWindowAlive()) return;
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    });

    updateMenu();
    return { updateMenu };
  },

  destroy() {
    tray?.destroy();
    tray = null;
  },
};
