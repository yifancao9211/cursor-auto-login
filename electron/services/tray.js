import { Tray, Menu, nativeImage, app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray = null;

export const trayService = {
  init(mainWindow, { accountDb, onSmartSwitch, onRefresh, onSwitchAccount }) {
    if (tray) return;

    const iconPath = path.join(__dirname, "../../build/icon.png");
    let icon;
    try {
      icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
      icon.setTemplateImage(true);
    } catch {
      icon = nativeImage.createEmpty();
    }

    tray = new Tray(icon);
    tray.setToolTip("Cursor Account Manager");

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
        {
          label: "显示窗口",
          click: () => {
            mainWindow?.show();
            mainWindow?.focus();
          },
        },
        { label: "退出", click: () => app.quit() },
      ]);

      tray.setContextMenu(menu);
      tray.setToolTip(`Cursor Manager — ${withBalance.length} 个有余额`);
    };

    tray.on("click", () => {
      if (mainWindow?.isDestroyed()) return;
      if (mainWindow?.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow?.show();
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
