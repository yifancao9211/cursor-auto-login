/**
 * predev 预检脚本
 * 在 pnpm run dev 前自动检查 Electron 和 better-sqlite3 原生模块是否就绪。
 * 如有缺失，自动尝试修复。
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let needRebuild = false;

// ========== 1. 检查 Electron 二进制 ==========
function checkElectron() {
  try {
    const electronPath = require("electron");
    if (typeof electronPath === "string" && fs.existsSync(electronPath)) {
      console.log("✅ Electron 二进制已就绪:", electronPath);
      return;
    }
  } catch {
    // fall through
  }

  console.log("⚠️  Electron 二进制缺失，正在重新安装...");
  try {
    // 找到 electron 的 install.js 并执行
    const electronDir = path.dirname(require.resolve("electron/package.json"));
    const installScript = path.join(electronDir, "install.js");
    if (fs.existsSync(installScript)) {
      execSync(`node "${installScript}"`, { stdio: "inherit", cwd: electronDir });
    } else {
      // fallback: 直接用 pnpm rebuild
      execSync("pnpm rebuild electron", { stdio: "inherit" });
    }
    console.log("✅ Electron 二进制安装完成");
  } catch (e) {
    console.error("❌ Electron 二进制安装失败:", e.message);
    console.error("   请尝试手动运行: rm -rf node_modules/.pnpm/electron* && pnpm install");
    process.exit(1);
  }
}

// ========== 2. 检查 better-sqlite3 原生模块 ==========
function checkBetterSqlite3() {
  try {
    // 尝试找到 .node 文件
    const sqliteDir = path.dirname(require.resolve("better-sqlite3/package.json"));
    const nodePath = path.join(sqliteDir, "build", "Release", "better_sqlite3.node");
    if (fs.existsSync(nodePath)) {
      console.log("✅ better-sqlite3 原生模块已就绪");
      return;
    }
  } catch {
    // fall through
  }

  console.log("⚠️  better-sqlite3 原生模块缺失，需要重新编译...");
  needRebuild = true;
}

// ========== 3. 按需重新编译原生依赖 ==========
function rebuildNative() {
  if (!needRebuild) return;
  try {
    console.log("🔨 正在为 Electron 重新编译原生模块...");
    execSync("npx electron-builder install-app-deps", { stdio: "inherit" });
    console.log("✅ 原生模块编译完成");
  } catch (e) {
    console.error("❌ 原生模块编译失败:", e.message);
    console.error("   请尝试手动运行: npx electron-builder install-app-deps");
    process.exit(1);
  }
}

// ========== 执行 ==========
console.log("\n🔍 预检查开发环境依赖...\n");
checkElectron();
checkBetterSqlite3();
rebuildNative();
console.log("\n🚀 预检通过，准备启动开发环境...\n");
