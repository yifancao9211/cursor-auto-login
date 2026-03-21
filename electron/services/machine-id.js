import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { app } from "electron";

function getCursorDataDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Cursor");
  } else if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Cursor");
  } else {
    return path.join(os.homedir(), ".config", "Cursor");
  }
}

const STORAGE_JSON_PATH = path.join(
  getCursorDataDir(),
  "User",
  "globalStorage",
  "storage.json"
);

const TELEMETRY_KEYS = {
  machineId: "telemetry.machineId",
  macMachineId: "telemetry.macMachineId",
  devDeviceId: "telemetry.devDeviceId",
  sqmId: "telemetry.sqmId",
};

export const machineIdService = {
  /**
   * 生成一组随机机器码
   * sqmId 参考当前值：有值则生成新值，空则保持空
   */
  generate(currentIds = {}) {
    return {
      machineId: crypto.randomBytes(32).toString("hex"),
      macMachineId: crypto.randomBytes(32).toString("hex"),
      devDeviceId: crypto.randomUUID(),
      sqmId: currentIds.sqmId
        ? `{${crypto.randomUUID().toUpperCase()}}`
        : "",
    };
  },

  /**
   * 从 storage.json 读取当前机器码
   */
  readCurrent() {
    try {
      const data = JSON.parse(fs.readFileSync(STORAGE_JSON_PATH, "utf-8"));
      return {
        machineId: data[TELEMETRY_KEYS.machineId] || "",
        macMachineId: data[TELEMETRY_KEYS.macMachineId] || "",
        devDeviceId: data[TELEMETRY_KEYS.devDeviceId] || "",
        sqmId: data[TELEMETRY_KEYS.sqmId] || "",
      };
    } catch (e) {
      console.error("[machine-id] Failed to read storage.json:", e.message);
      return null;
    }
  },

  /**
   * 将机器码写入 storage.json（仅修改 4 个 telemetry 字段，保留其他内容）
   */
  writeTo(ids) {
    try {
      const raw = fs.readFileSync(STORAGE_JSON_PATH, "utf-8");
      const data = JSON.parse(raw);

      data[TELEMETRY_KEYS.machineId] = ids.machineId;
      data[TELEMETRY_KEYS.macMachineId] = ids.macMachineId;
      data[TELEMETRY_KEYS.devDeviceId] = ids.devDeviceId;
      data[TELEMETRY_KEYS.sqmId] = ids.sqmId;

      const tmpPath = STORAGE_JSON_PATH + ".tmp";
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
      fs.renameSync(tmpPath, STORAGE_JSON_PATH);
      console.log("[machine-id] storage.json updated successfully");
      return { success: true };
    } catch (e) {
      console.error("[machine-id] Failed to write storage.json:", e.message);
      return { success: false, error: e.message };
    }
  },

  /**
   * 备份当前机器码到 userData 目录
   */
  backupOriginal() {
    try {
      const current = this.readCurrent();
      if (!current) return { success: false, error: "无法读取当前机器码" };

      const backupPath = path.join(app.getPath("userData"), "machine-id-backup.json");
      // 只在没有备份时才备份（保留最初的原始值）
      if (!fs.existsSync(backupPath)) {
        fs.writeFileSync(backupPath, JSON.stringify(current, null, 2), "utf-8");
        console.log("[machine-id] Original machine IDs backed up to:", backupPath);
      }
      return { success: true, path: backupPath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /**
   * 恢复原始机器码
   */
  restoreOriginal() {
    try {
      const backupPath = path.join(app.getPath("userData"), "machine-id-backup.json");
      if (!fs.existsSync(backupPath)) {
        return { success: false, error: "未找到备份文件" };
      }

      const backup = JSON.parse(fs.readFileSync(backupPath, "utf-8"));
      const result = this.writeTo(backup);
      if (result.success) {
        console.log("[machine-id] Original machine IDs restored");
      }
      return result;
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
};
