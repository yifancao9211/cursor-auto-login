# Cursor Account Manager

Electron 桌面应用，用于管理多个 Cursor IDE 账号。支持一键切号、配额查询、批量登录、组织成员自动发现。

## 功能特性

- 🔄 **一键切号** — 在多个 Cursor 账号之间无缝切换，自动写入所有必要的认证字段
- 📊 **配额查询** — 实时查看每个账号的 usage 和余额，支持余额排序
- 🤖 **自动巡检** — 后台定时检查所有账号 Token 有效性和余额变化
- 👥 **组织入库** — 自动发现团队成员并批量入库（通过 Cursor Team API）
- 🔑 **批量登录** — 使用 Playwright 自动化浏览器批量获取 Token
- 🆔 **机器码管理** — 每个账号独立的 machine ID，切号时自动替换
- 📋 **批量导入** — 支持粘贴 JSON 格式的 Token 数据快速导入
- 🏷️ **状态管理** — 账号状态分类：活跃 / 待登录 / 失败 / 已禁用

## 快速开始

```bash
# 安装依赖
pnpm install

# 开发模式运行
pnpm run dev

# 构建生产包
pnpm run build
```

## 技术栈

| 层 | 技术 |
|:---|:---|
| 框架 | Electron 33 |
| 前端 | Vue 3 + Pinia |
| 样式 | Tailwind CSS |
| 数据库 | better-sqlite3 |
| 自动化 | Playwright (登录) |
| 构建 | Vite + electron-builder |

## 项目结构

```
├── electron/                 # 主进程
│   ├── main.js              # 入口，IPC、自动巡检、组织发现
│   ├── preload.cjs          # IPC 桥接
│   └── services/
│       ├── account-db.js    # SQLite 账号数据库
│       ├── cursor-api.js    # Cursor API (usage/stripe/teams)
│       ├── cursor-db.js     # 读写 Cursor 的 state.vscdb
│       ├── login.js         # Playwright 自动登录
│       ├── machine-id.js    # 机器码生成与管理
│       └── switcher.js      # 账号切换逻辑
├── ui/                       # 渲染进程 (Vue)
│   ├── views/
│   │   ├── Dashboard.vue    # 仪表盘总览
│   │   ├── Accounts.vue     # 账号管理（详细/紧凑视图）
│   │   ├── Onboarding.vue   # 入库与登录管理
│   │   └── Settings.vue     # 设置（巡检间隔、并发数等）
│   ├── components/
│   │   ├── BatchLoginDialog.vue
│   │   └── SwitchDialog.vue
│   └── stores/app.js        # Pinia 状态管理
├── index.html
├── vite.config.js
├── tailwind.config.js
└── package.json
```

## 账号状态流转

```
新增/导入 → [new] → 批量登录 → [active] ← 巡检刷新
                         ↓
                     [failed] ⇄ [disabled]
                         ↓
                     批量重试 → [active]
```

## 使用的 Cursor API

| 接口 | 方法 | 用途 |
|:---|:---|:---|
| `/api/usage-summary` | GET | 查询用量和余额 |
| `/api/auth/stripe` | GET | 获取 membershipType / teamId |
| `/api/dashboard/teams` | POST | 获取团队列表 |
| `/api/dashboard/get-team-spend` | POST | 获取团队计费成员（分页） |

## 安全说明

- `accounts.db`、`.env`、`tokens.json` 等敏感文件已加入 `.gitignore`
- Electron 使用 `contextIsolation: true` + `nodeIntegration: false`
- 所有主进程通信通过 IPC Handler

## License

MIT
