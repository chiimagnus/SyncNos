# Chrome 到 Safari 迁移差异清单（WebClipper）

> 目标：为后续把 WebClipper 从 Chrome MV3 迁移到 Safari Web Extension 提供可执行的差异列表与改造点。

## 1. 打包与工程形态

- Chrome：直接加载 `manifest.json` 目录（开发者模式），发布为 `.crx` 或商店包。
- Safari：需要通过 Xcode 创建 `Safari Web Extension` 宿主 App；扩展资源会被打包进 App。

## 2. API 可用性差异

- `chrome.*` 与 `browser.*`
  - Safari 支持 WebExtensions API，但覆盖度与行为可能与 Chrome 有差异。
  - 建议在代码层集中封装一层 `browserApi` 适配，减少平台分支散落。
- `chrome.downloads`
  - Safari 上可能行为受限或需要替代实现（例如通过 content 页面触发下载，或使用新的导出策略）。
  - 影响范围：聊天导出（JSON/Markdown/zip）与 Database Backup（备份 JSON）的下载。
- `chrome.webNavigation`
  - Safari 对 webNavigation 事件支持与过滤行为可能存在差异；OAuth 回调拦截需要重点验证。
- `chrome.scripting`
  - Safari 的脚本注入能力需要验证（是否支持 `executeScript` 注入 files/func）。
  - 文章抓取功能依赖注入：可能需要改成 content script 常驻 + optional permission，或改用 Safari 兼容方式。

## 3. 权限与 Host Permissions

- Chrome：`host_permissions` + `optional_host_permissions` 可组合使用；可在运行时请求站点权限。
- Safari：运行时请求站点权限与 UI 可能不同；需要明确“扩展可访问的网站”策略与用户授权路径。

## 4. OAuth 回调处理

- 当前实现：background 监听 `redirectUri` 的导航（`webNavigation.onCommitted`），校验 `state` 后换 token。
- Safari 风险点：
  - 回调页是否会在 Safari 扩展上下文被可靠捕获。
  - 回调页打开方式（新 tab / 重定向）对事件触发的影响。
  - 若 `webNavigation` 行为不一致，可能需要改成：回调页注入 content script 将 `code/state` 通过 message 回传 extension。

## 5. 存储与数据层

- IndexedDB：Safari 支持 IndexedDB，但在扩展/私密模式下的持久化策略需验证。
- `chrome.storage.local`：Safari 支持但容量与持久化细节需确认。

## 6. 需要优先验证的功能清单

1. 自动采集：MutationObserver + debounce 是否稳定。
2. popup UI：列表/导出/Database Backup（导出/导入）/同步按钮是否正常（尤其是文件选择与下载行为）。
3. OAuth：授权跳转、回调捕获、token 持久化是否可靠。
4. Notion API：跨域 fetch 是否可用。
5. on-demand 文章抓取：站点授权 + 注入脚本是否可用。
