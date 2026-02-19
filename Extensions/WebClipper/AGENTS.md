# SyncNos WebClipper（浏览器扩展）Agent 指南

WebClipper 是本仓库中的一个独立浏览器扩展（基于 WebExtensions / MV3）。它会从支持的网站抓取 AI 聊天对话并保存到浏览器本地数据库，支持导出（JSON/Markdown）、本地数据库备份/恢复（导出/导入，合并导入），以及手动同步到 Notion。

## 作用范围

- 目标目录：`Extensions/WebClipper/`
- 平台：
  - Chrome / Chromium（开发时通过“加载已解压的扩展程序”）
  - Firefox（已上架 AMO：https://addons.mozilla.org/firefox/addon/syncnos-webclipper/；开发可用临时扩展）
- 支持的网站（content scripts）：ChatGPT、Claude、Gemini、DeepSeek、Kimi、豆包、元宝、NotionAI
- 数据：本地存储（IndexedDB + `chrome.storage.local`）；网络请求主要是手动同步时的 Notion OAuth + Notion API

## 关键约束

- 修改应聚焦在：采集 -> 本地持久化 -> 导出/备份/导入 -> 手动 Notion 同步。
- 权限保持最小且明确；避免添加 `*://*/*` 或无关的 Chrome API。
- 除 `chrome.storage.local` 外，不要记录或持久化任何密钥（Notion OAuth client secret 由用户提供）。
- 优先本地优先体验：自动采集只保存本地；Notion 同步由用户触发，且可能覆盖目标页面内容。

## 工程开发规范（建议）
以下规范用于保持 WebClipper 可维护、可扩展、可调试，并减少“看起来点了但其实没生效”的隐性故障。

### 通用原则
- **SOLID（适配到本项目的 JS 架构）**
  - **S（单一职责）**：UI（popup）、数据层（IndexedDB/storage）、抓取（collectors）、同步（notion sync）分离；避免“一个模块既抓又存又同步又渲染”。
  - **O（开闭原则）**：新增平台优先通过新增 `collector` + 注册表扩展完成，避免在多处 `switch/if` 扩散。
  - **I（接口隔离）**：以最小能力的“contract/shape”交互（例如 collector 只暴露 `matches/capture`），避免把内部实现细节泄露到调用方。
  - **D（依赖倒置）**：业务逻辑依赖抽象（例如 `notionApi.notionFetch` / `tokenStore`），在测试里可替换 mock。
- **DRY**：重复逻辑抽成共享函数（`popup-core`、`collector-utils`、`notion-api`）；但不要为了抽象而抽象。
- **KISS**：优先可读性与可调试性，避免过度封装、过度动态化。
- **YAGNI**：不为“可能用到”提前引入权限、存储字段、复杂配置项。

### 可观测性与错误处理
- **不要静默吞错**：除非能证明是“可忽略且不影响主流程”的错误，否则必须：
  - 返回结构化错误（`{ ok: false, error: { message, extra } }`），或
  - 在 UI 侧给出明确提示（例如 `alert`/状态文本），并避免无限弹窗。
- **关键路径必须可诊断**：Notion OAuth、Parent Page 选择、同步入口、数据库创建/复用、页面创建/更新、写入 blocks 都应在失败时提供明确错误上下文。
- **避免记录敏感信息**：日志中不要输出 access token、cookie、完整页面内容；必要时只输出摘要/长度/计数。

### 状态与持久化

- **持久化要“显式且一致”**：任何后台流程依赖的配置值（例如 Notion parent page id）都必须在 UI 层确保写入存储；不要依赖“用户碰巧触发了 change”。
- **迁移优先、破坏性操作谨慎**：IndexedDB schema 变更需要迁移策略；备份/导入需兼容旧版本字段与去重规则。

### MV3 / WebExtensions 实务

- **Popup 只负责触发与展示**：长任务放后台 Service Worker 执行，popup 通过 message 获取进度/结果。
- **节流与速率限制**：对 Notion 写入必须做 pacing/批量；批量同步要能部分失败不影响其它项。
- **权限变更需要理由**：新增 `permissions/host_permissions` 前先给出“为何需要、替代方案为何不行、风险与范围控制”。

### 测试与回归

- 涉及以下改动时优先补 `vitest`（`Extensions/WebClipper/tests`）：
  - Notion 同步（blocks 生成、分页/批量、错误分支）
  - OAuth 状态机（pending/error/connected）
  - IndexedDB schema/migration、备份导入合并规则
  - Collector 解析规则（结构变化、空态、异常 DOM）

## Quick Start

- 安装依赖：`npm --prefix Extensions/WebClipper install`
- 本地开发（Chrome）：在 `chrome://extensions` 加载 `Extensions/WebClipper/`
- 构建 Chrome dist：`npm --prefix Extensions/WebClipper run build`
- 构建 Firefox `.xpi`：`npm --prefix Extensions/WebClipper run build:firefox`

## 命令

- 静态检查（manifest/icons + JS 语法）：`npm --prefix Extensions/WebClipper run check`
- 单元测试（Vitest）：`npm --prefix Extensions/WebClipper run test`
- 构建打包（Chrome dist）：`npm --prefix Extensions/WebClipper run build`
- 构建打包（Firefox `.xpi`）：`npm --prefix Extensions/WebClipper run build:firefox`
- 校验 Firefox 产物（不做源码语法检查）：`npm --prefix Extensions/WebClipper run check:dist:firefox`
- 生成 AMO 源码包（Source code 上传）：`npm --prefix Extensions/WebClipper run package:amo-source`

## Firefox / AMO

- AMO（商店页）：https://addons.mozilla.org/firefox/addon/syncnos-webclipper/

### 本地加载（Firefox 临时扩展）

1. 打开 `about:debugging#/runtime/this-firefox`
2. 点击 “Load Temporary Add-on…”
3. 选择 `Extensions/WebClipper/dist-firefox/manifest.json`

### AMO 发布产物

- 提交包（AMO Add-on）：`SyncNos-WebClipper-firefox.xpi`
- 源码包（AMO Source code）：`SyncNos-WebClipper-amo-source.zip`

### AMO Source Package（Reviewer 复现构建说明）

- 源码包应包含可读源码（不转译/拼接/压缩），并能复现提交的 `.xpi`
- 环境要求（已在本仓库验证）：
  - OS: macOS / Linux / Windows
  - Node.js: `v25.1.0`
  - npm: `11.6.2`
  - `zip` 命令：macOS 自带；Ubuntu/Debian 可用 `sudo apt-get install zip`
- 构建步骤：
  1. `npm --prefix Extensions/WebClipper install`
  2. `npm --prefix Extensions/WebClipper run build:firefox`
- 依赖说明：
  - popup 预览使用 `markdown-it`，构建会读取 `node_modules/markdown-it/dist/markdown-it.js`（上游未压缩 bundle）并打包进 `dist-firefox/popup.js`

## Chrome 开发

- 打开 `chrome://extensions`
- 启用开发者模式
- 加载已解压扩展：`Extensions/WebClipper/`
