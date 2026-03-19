# Cursor Auto Login

使用 Playwright 自动登录 Cursor 账号，批量测试账号、查询余额、管理 Token。

## 快速开始

```bash
# 1. 安装依赖
npm install
npm run setup

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 设置 CURSOR_EMAIL / CURSOR_PASSWORD 等

# 3. 在 accounts.txt 中填入要测试的邮箱（每行一个）
```

## 命令一览

| 命令 | 用途 | 说明 |
|:---|:---|:---|
| `npm run login` | 单账号登录 | 使用 `.env` 中的账号密码 |
| `npm run login:reset` | 重置登录态 | 清除本地会话缓存 |
| `npm run batch` | 批量登录 | 读取 `accounts.txt`，3路并行登录，获取 Token |
| `npm run balance` | 查询余额 | 用已有 Token 秒查所有账号余额（无需浏览器） |
| `npm run check-new` | 检测新增账号 | 对比 `accounts.txt`，只登录尚未处理过的新账号 |
| `npm run retry` | 重试失败账号 | 每5天自动重试，未到时间会跳过 |
| `npm run retry:force` | 强制重试 | 忽略5天间隔，立即重试所有失败账号 |

## 日常使用流程

```
1. 首次：npm run batch         → 批量登录，获取 Token
2. 日常：npm run balance       → 秒查所有账号余额
3. 定期：npm run retry         → 重试之前失败的账号
```

## 环境变量

在 `.env` 中配置：

| 变量 | 默认值 | 说明 |
|:---|:---|:---|
| `BATCH_PASSWORD` | `abcd@1234` | 批量登录的统一密码 |
| `CURSOR_HEADLESS` | `true` | 是否无头模式运行浏览器 |
| `CONCURRENCY` | `3` | 批量登录的并行数 |

## 文件说明

### 脚本文件

| 文件 | 说明 |
|:---|:---|
| `src/batch-login.mjs` | 批量登录脚本，读取 `accounts.txt`，并行登录并获取 Token 和余额 |
| `src/check-balance.mjs` | 余额查询脚本，纯 API 调用，读取 `tokens.json` 查余额 |
| `src/retry-failed.mjs` | 失败重试脚本，读取 `failed_accounts.json`，5天间隔自动重试 |

### 数据文件

| 文件 | 说明 |
|:---|:---|
| `accounts.txt` | 待测试的邮箱列表，每行一个，`#` 开头为注释 |
| `tokens.json` | 已获取的 Token 缓存（邮箱 → WorkosCursorSessionToken） |
| `failed_accounts.json` | 登录失败的账号列表及上次重试时间 |
| `results.json` | 批量登录的详细结果（含余额、错误信息） |
| `balance.json` | 最近一次余额查询的原始数据 |
| `valid_accounts_report.md` | 生成的余额报告（Markdown 表格，含 Token） |

### 其他

| 文件/目录 | 说明 |
|:---|:---|
| `.env` | 环境变量配置（不提交 git） |
| `.cursor-session/` | 单账号登录的浏览器会话缓存 |
| `.batch-sessions/` | 批量登录的临时浏览器目录（运行后自动清理） |

## 工作原理

1. **登录流程**：`authenticator.cursor.sh`（输入邮箱）→ `auth0.com`（输入邮箱+密码）→ 回调 `cursor.com`
2. **Token 获取**：登录成功后从 Cookie 中提取 `WorkosCursorSessionToken`
3. **余额查询**：用 Token 调用 `https://cursor.com/api/usage-summary` API
4. **缓存复用**：已有有效 Token 的账号直接查 API，跳过浏览器登录

## 安全说明

- 不要把账号密码和 Token 提交到 git
- `.env`、`tokens.json`、`results.json`、`accounts.txt` 等敏感文件已加入 `.gitignore`
