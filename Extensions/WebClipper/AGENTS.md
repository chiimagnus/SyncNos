# SyncNos WebClipper（浏览器扩展）Agent 指南

WebClipper 是本仓库中的一个独立浏览器扩展（基于 WebExtensions / MV3）。它会从支持的网站抓取 AI 聊天对话并保存到浏览器本地数据库，然后允许用户导出（JSON/Markdown）或手动同步到 Notion。

## 作用范围

- 目标目录：`Extensions/WebClipper/`
- 平台：
  - Chrome / Chromium（开发时通过“加载已解压的扩展程序”）
  - Firefox（发布通过 AMO 签名；开发可用临时扩展）
- 支持的网站（content scripts）：ChatGPT、Claude、Gemini、DeepSeek、Kimi、豆包、元宝、NotionAI
- 数据：本地存储（IndexedDB + `chrome.storage.local`）；网络请求主要是手动同步时的 Notion OAuth + Notion API

## 关键约束

- 修改应聚焦在：采集 -> 本地持久化 -> 导出 -> 手动 Notion 同步。
- 权限保持最小且明确；避免添加 `*://*/*` 或无关的 Chrome API。
- 除 `chrome.storage.local` 外，不要记录或持久化任何密钥（Notion OAuth client secret 由用户提供）。
- 优先本地优先体验：自动采集只保存本地；Notion 同步由用户触发，且可能覆盖目标页面内容。

## 架构（高层）

- 内容脚本（`src/bootstrap/content.js`）：选择当前活跃 collector，监听 DOM 变化，计算增量快照，向后台执行 upsert，并提供页面内“保存”按钮。
- Collectors（`src/collectors/*-collector.js`）：各平台提取器，输出标准化 `{ conversation, messages }` 快照。
- 后台 Service Worker（`src/bootstrap/background.js`）：IndexedDB 的 CRUD、同步映射、Notion OAuth 回调处理（通过 `webNavigation`）以及批量 Notion 同步。
- 弹窗 UI（`src/ui/popup/*`）：聊天列表选择、导出菜单（JSON/Markdown）、Notion 连接与父页面选择的设置页。
  - 按业务拆分为多文件：`popup-core.js`（共享能力）、`popup-tabs.js`、`popup-list.js`、`popup-chat-preview.js`（Chats 左键单击预览弹层，使用 `markdown-it` 做轻量 Markdown 渲染）、`popup-export.js`、`popup-notion.js`、`popup-about.js`、`popup.js`（初始化编排）。
- Notion 同步（`src/sync/notion/*`）：按来源创建/复用数据库，创建/更新页面，清空子块并追加新块。

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
