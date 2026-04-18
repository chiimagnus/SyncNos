# 依赖关系

macOS/ 历史资料已归档；本页仅保留 WebClipper 与发布链路的依赖事实。

## 构建与运行时矩阵

| 产品线 / 层 | 语言 | 核心运行时 / 框架 | 构建入口 | 运行目标 |
| --- | --- | --- | --- | --- |
| WebClipper | TypeScript 5.9 | WXT、MV3、React 19、React Router 7、Vitest | `webclipper/package.json`, `wxt.config.ts` | Chrome / Edge / Firefox；同一运行时覆盖 chat/article/video transcript 采集 |
| 交付层 | YAML + Node 22（CI）/20（发布） | GitHub Actions、打包脚本、商店 API | `.github/workflows/*.yml`, `.github/scripts/webclipper/*.mjs` | GitHub Release / CWS / AMO |

## WebClipper 主要依赖

| 依赖 | 类型 | 版本 | 用途 |
| --- | --- | --- | --- |
| `react`, `react-dom` | runtime | `^19.2.4` | popup / app UI 渲染 |
| `react-router-dom` | runtime | `7.13.1` | 扩展内部 app 路由 |
| `recharts` | runtime | `^3.8.0` | Settings Insight 的来源分布 / 域名分布图表 |
| `markdown-it` | runtime | `^14.1.0` | Markdown 消息渲染 |
| `lucide-react` | runtime | `^0.541.0` | UI 图标 |
| `wxt` | dev | `^0.20.18` | MV3 开发与构建 |
| `@wxt-dev/module-react` | dev | `^1.1.5` | WXT React 模块 |
| `typescript` | dev | `^5.9.3` | 类型检查与编译约束 |
| `vitest` | dev | `^2.1.8` | 单元测试 |
| `fake-indexeddb`, `jsdom` | dev | `^6.2.2`, `^28.1.0` | 存储与 DOM 测试环境 |
| `tailwindcss`, `postcss`, `autoprefixer` | dev | `^3.4.17`, `^8.5.6`, `^10.4.21` | 扩展 UI 样式链 |

- 视频字幕采集不引入独立第三方依赖；它继续复用现有 DOM、content script、message contract 与 WXT 运行时。

## 外部服务与平台

| 服务 / 平台 | 调用方 | 方式 | 作用 |
| --- | --- | --- | --- |
| Notion OAuth authorize + Notion API | App + WebClipper | HTTPS | Parent Page、数据库、页面属性、blocks 写入 |
| Notion OAuth Worker（`syncnos-notion-oauth`） | WebClipper | HTTPS `POST /notion/oauth/exchange` | 在 Worker 端持有 `client_secret` 完成 code exchange，避免扩展侧暴露密钥 |
| Obsidian Local REST API | WebClipper | 本地 HTTP（默认 `http://127.0.0.1:27123`） | 把会话或文章写入 vault |
| 浏览器 DOM | WebClipper | content script | 采集 AI 对话、网页正文与视频字幕 |
| GitHub Release / CWS / AMO | workflow + scripts | GitHub Actions / 商店 API | 生成与发布浏览器扩展产物 |

## 工具链与验证入口

| 工具 / 命令 | 位置 | 用途 | 备注 |
| --- | --- | --- | --- |
| `npm --prefix webclipper run compile` | `package.json` | TypeScript 类型检查 | 默认验证顺序第一步 |
| `npm --prefix webclipper run test` | `package.json` | Vitest 单元测试 | 游标、迁移、Markdown、存储逻辑 |
| `npm --prefix webclipper run build` | `package.json` | 生成 Chrome / Edge 构建产物 | `check` 之前的基础步骤 |
| `npm --prefix webclipper run check` | `package.json` | build 后跑 `check-dist.mjs` | 验证 dist 完整性与关键引用 |
| `node .github/scripts/webclipper/package-release-assets.mjs` | `.github/scripts/webclipper/` | 打包 Chrome / Edge / Firefox 正式附件 | workflow 直接复用 |

## 版本与兼容性规则

| 项 | 当前值 | 来源 | 为什么重要 |
| --- | --- | --- | --- |
| WebClipper `package.json` 版本 | `2003.08.20` | `webclipper/package.json` | 表示 npm 包层面的版本语义 |
| WebClipper manifest 版本 | 见 `configuration.md`（单一事实源） | `webclipper/wxt.config.ts` | CWS / AMO / Edge workflow 直接拿它和 tag 对齐 |
| Manifest 模式 | `3` | `wxt.config.ts` | 决定扩展是 MV3 架构 |
| CI / 发布 Node 版本 | `CI: 22`；`release/publish: 20` | `webclipper-ci.yml` + `webclipper-release.yml` / `webclipper-amo-publish.yml` / `webclipper-cws-publish.yml` / `webclipper-edge-publish.yml` | 区分开发验证与渠道打包环境，同时保持发布链路一致 |

- **重要区分**：WebClipper 发布 workflow 只强制校验 `wxt.config.ts` 的 `manifest.version` 与 `v*` tag 是否一致，不会校验 `package.json` 的 `version`。
- **OAuth 交换边界**：扩展回调后会把 `code` 发给 `https://syncnos-notion-oauth.chiimagnus.workers.dev/notion/oauth/exchange`；Worker 再向 Notion token endpoint 交换 `access_token`。
- **权限边界**：扩展 manifest 使用 `storage`, `contextMenus`, `tabs`, `webNavigation`, `activeTab`, `scripting`，并配合广泛 `host_permissions` 覆盖支持站点与普通网页；UI 是否真正启动仍受运行时 gating 控制。

## 修改依赖时最应该注意什么

| 改动类型 | 先看哪里 | 需要同步什么 |
| --- | --- | --- |
| 扩展新增依赖 / 构建插件 | `package.json`, `wxt.config.ts`, workflow | 构建、本地验证、CI 环境 |
| 发布版本调整 | `wxt.config.ts`, `webclipper-amo-publish.yml`, `webclipper-cws-publish.yml`, `webclipper-edge-publish.yml` | manifest version 与 tag |
| 新增权限或 host 权限 | `wxt.config.ts`, `src/services/bootstrap/content.ts` | manifest、运行时 gating、文档 |

## 来源引用（Source References）
- `webclipper/package.json`
- `webclipper/wxt.config.ts`
- `webclipper/src/services/sync/notion/auth/oauth.ts`
- `webclipper/cloudflare-workers/syncnos-notion-oauth/index.ts`
- `webclipper/src/entrypoints/video-transcript-interceptor.content.ts`
- `webclipper/src/entrypoints/video-transcript-bridge.content.ts`
- `webclipper/src/services/bootstrap/video-transcript-capture.ts`
- `webclipper/src/services/bootstrap/video-transcript-capture-content-handlers.ts`
- `webclipper/src/services/protocols/conversation-kinds.ts`
- `webclipper/src/ui/settings/sections/VideosSection.tsx`
- `.github/workflows/webclipper-release.yml`
- `.github/workflows/webclipper-amo-publish.yml`
- `.github/workflows/webclipper-cws-publish.yml`
- `.github/scripts/webclipper/package-release-assets.mjs`

## 更新记录（Update Notes）
- 2026-04-18：补充视频字幕采集的依赖边界说明，明确它复用现有 WXT / DOM / message contract 运行时而不引入新的第三方库。
- 2026-04-16：将依赖页的 Node 版本说明拆分为 CI 22 / 发布 20，避免把开发验证与渠道打包环境混为一谈。
- 2026-03-19：补充 Notion OAuth Worker 作为外部集成边界，明确 token exchange 路径与 Obsidian 默认本地 API 地址。
