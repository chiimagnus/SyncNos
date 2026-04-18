# 概览

macOS/ 历史资料已归档；本页仅保留 WebClipper 的目录、入口与运行时总览。

## 仓库是什么
SyncNos 现在围绕“异构内容 → 稳定知识资产”展开的是 WebClipper 主线；正式的业务入口页是 [business-context.md](business-context.md)，本页负责在业务语义之上再给出目录、入口、运行时和产物层面的整体地图。

| 产品线 | 主目录 | 运行时 | 主要输入 | 主要输出 |
| --- | --- | --- | --- | --- |
| WebClipper | `webclipper/` | MV3 service worker + content script + popup/app React UI | AI 站点 DOM、网页正文、视频字幕响应、浏览器本地设置、备份包 | IndexedDB、Settings Insight、主题/行为偏好、本地导出、Zip v2 备份（含 `article_comments`）、Notion 页面、Obsidian 文件、`SyncNos-Videos` |

## 顶层目录地图

| 路径 | 角色 | 典型内容 | 阅读建议 |
| --- | --- | --- | --- |
| `macOS/` | 已归档历史资料 | `SyncNos/`, `SyncNos.xcodeproj/`, `Packages/`, `Resource/` | 如需查历史，仅参考归档说明。 |
| `webclipper/` | 浏览器扩展 | `src/entrypoints/`, `src/collectors/`, `src/services/conversations/`, `src/services/comments/`, `src/services/sync/`, `src/ui/` | 先判断改动属于 background / content / popup / app / comments 哪一层；Inpage 设置（阅读风格 / anti-hotlink）落在 `src/ui/settings/sections/InpageSection.tsx`。 |
| `macOS/SyncNos/*.md` / `.github/guide/` | 已归档的专项文档与仓库指南 | 键盘焦点、OCR、Obsidian Local REST API 指南等 | 仅供历史查阅。 |
| `.github/workflows/` | CI / Release / 商店发布入口 | `release.yml`, `webclipper-release.yml`, `webclipper-amo-publish.yml`, `webclipper-cws-publish.yml`, `webclipper-edge-publish.yml` | 看真实交付链路而不是猜测。 |
| `.github/scripts/webclipper/` | WebClipper 打包 / 发布脚本 | 打包 release assets、AMO source、AMO 发布 | 与 workflow 配套理解渠道差异。 |

**2026-04 重大架构变化**：
- **评论模块 React 迁移**：`src/ui/comments/react/` 新增完整 React 实现（~810 行），删除 legacy `render.ts`（543 行），引入 `panel-store.ts` + `focus-rules.ts` 架构。
- **Settings 界面重构**：新增 `SettingsTopTabsNav.tsx`（窄屏顶部标签导航），支持关闭按钮，部分设置项改为 blur 自动保存；Inpage 分区承载阅读风格与 anti-hotlink 域名编辑。
- **AppShell/ConversationsScene 重构**：引入 `listShell` 属性和 `CapturedListPaneShell` 组件，删除 `CapturedListSidebar.tsx`，popup/app 共享列表架构。
- **Notion/Obsidian 评论数同步**：新增 `comment-metrics.ts`，Notion 写入 "Comment Threads" 属性，Obsidian frontmatter 写入 `comments_root_count`。
- **文章提取增强**：新增 bilibili 动态支持，移除小红书适配器，优化 Discourse `<details>` code blocks 处理。
- **视频字幕采集**：新增 YouTube / Bilibili 字幕抓取、`VideosSection.tsx` 设置分区、`Save video transcript` 右键菜单和 `video` conversation kind。

## 关键入口文件

| 入口 | 路径 | 作用 | 为什么先看这里 |
| --- | --- | --- | --- |
| 扩展后台入口 | `webclipper/src/entrypoints/background.ts` | 注册消息处理、sync orchestrator、Notion OAuth 监听、清理孤儿 job；仅首次安装自动打开 About 分区 | 它决定所有后台能力如何挂接，以及安装/升级时是否主动打断用户 |
| 扩展内容入口 | `webclipper/src/entrypoints/content.ts` | 注册 collectors、inpage UI、runtime observer、增量更新 | 它决定页面采集是如何启动的 |
| 扩展设置入口 | `webclipper/src/ui/settings/SettingsScene.tsx` | 组织 `General / Chat with AI / Backup / Notion / Obsidian / Inpage / Insight / About` 分区；Inpage 里包含 `markdown_reading_profile_v1` 与 `anti_hotlink_rules_v1`，窄屏使用顶部标签导航，宽屏使用侧边栏导航，支持关闭按钮 | 它决定设置项如何被真正看见和进入 |
| 视频字幕入口 | `webclipper/src/ui/settings/sections/VideosSection.tsx` | 提供 YouTube / Bilibili 视频字幕采集说明、右键菜单入口与失败提示 | 它决定视频字幕采集如何被看见和进入 |
| 扩展共享下拉入口 | `webclipper/src/ui/shared/SelectMenu.tsx` | 统一菜单键盘行为与面板高度策略；`adaptiveMaxHeight` 会按最近可裁剪容器计算可视高度 | 它解释为什么底部 `source/site` 筛选菜单会随视口动态变高/变矮 |
| 扩展主题入口 | `webclipper/src/ui/styles/tokens.css` | 仅依赖 `prefers-color-scheme` 驱动 token 亮暗切换 | 它解释"为什么 popup / app / inpage 会随系统暗色" |
| 评论 React 入口 | `webclipper/src/ui/comments/react/ThreadedCommentsPanel.tsx` | 完整的 React 评论组件：composer、threads、replies、删除确认、Chat with AI 菜单、聚焦逻辑 | 评论模块已完成 React 迁移，不再是 DOM 直接操作 |
| 评论 Panel Store | `webclipper/src/ui/comments/react/panel-store.ts` | 外部 store 实现 `getSnapshot/subscribe` 模式，桥接 background handlers 与 React 渲染 | 理解评论状态如何从 background 流向 React 组件 |
| WXT / manifest 入口 | `webclipper/wxt.config.ts` | 版本号、权限、host permissions、entrypointsDir | 它是发布版本和能力边界的代码事实源 |
| 脚本入口 | `webclipper/package.json` | `dev`, `compile`, `test`, `build`, `check` | 它定义扩展侧默认验证顺序 |

## 主要来源与主要产物

| 类型 | 来源 / 产物 | 生产或消费方 | 说明 |
| --- | --- | --- | --- |
| 页面来源 | ChatGPT、Claude、Gemini、Google AI Studio、DeepSeek、Kimi、豆包、元宝、Poe、Notion AI、z.ai、普通网页、YouTube / Bilibili 视频页 | WebClipper | 扩展先采集为本地会话，再派生到任意目标 |
| 本地事实源 | IndexedDB / `chrome.storage.local` / `localStorage` / `sessionStorage` | WebClipper | 这是 debug、迁移、恢复、回归时最先要看的地方 |
| 外部结果 | Notion 数据库 / 页面、Obsidian 文件、Markdown / Zip 导出、Release 附件 | WebClipper + GitHub Actions | 对用户可见，但不是所有情况下都等于事实源 |

- WebClipper 的 Insight 统计面板是**本地会话库的只读视图**：它不生成新的导出产物，也不改变同步链路，而是把 `conversations + messages` 的累计结果变成可见的仪表盘。
- WebClipper 的 `Chat with AI` 是**本地会话库派生出的 UI 动作**：它复用 detail 数据生成 payload，并把结果复制到剪贴板后跳转外部站点。
- WebClipper 的会话列表底部 `today / total` 统计在 popup 与 app 中都可作为快捷入口跳到 Insight 分区，便于把列表与统计面板连成同一条导航路径。
- WebClipper 的视频字幕会话与 chat/article 共享同一份本地事实源：只要字幕已加载，就能写入 `SyncNos-Videos` 并继续走 Notion / Obsidian / Zip / Markdown 的后续链路。

## 常用命令与工程入口

| 场景 | 命令 / 入口 | 结果 |
| --- | --- | --- |
| 扩展安装依赖 | `npm --prefix webclipper install` | 安装 WebClipper 依赖 |
| 扩展类型检查 | `npm --prefix webclipper run compile` | 先发现 TS 类型 / 契约问题 |
| 扩展单测 | `npm --prefix webclipper run test` | 覆盖游标、IndexedDB 迁移、Markdown 等关键逻辑 |
| 扩展构建 | `npm --prefix webclipper run build` | 生成 Chrome / Edge 产物 |
| 扩展 Firefox 构建 | `npm --prefix webclipper run build:firefox` | 生成 Firefox 产物 |
| 扩展产物校验 | `npm --prefix webclipper run check` | build 后再跑 `check-dist.mjs` 做完整性检查 |

## 图表
![WebClipper 输出流程图](assets/repository-flow-01.svg)

```mermaid
flowchart LR
  C[AI 对话 / 网页正文] --> D[WebClipper]
  D --> E[Notion]
  D --> F[Markdown / Zip / Obsidian]
  D --> H[IndexedDB / chrome.storage.local]
```

## 推荐导航
- 如果你还没建立产品语义，先回到 [business-context.md](business-context.md)。
- 如果你需要判断“代码应该改哪里”，先看 [architecture.md](architecture.md) 和对应 `modules/` 页面。
- 如果你要改视频字幕采集，先看 [modules/videos.md](modules/videos.md) 再回到 [architecture.md](architecture.md) / [configuration.md](configuration.md)。
- 如果你想理解“为什么本地有这些缓存 / mapping / backup 文件”，优先看 [storage.md](storage.md)。
- 如果你要发布 WebClipper，优先看 [release.md](release.md)、[configuration.md](configuration.md) 和 [testing.md](testing.md)。
- 如果你正在排查“配置没生效 / 按钮不显示 / workflow 失败 / 同步重建”，优先看 [troubleshooting.md](troubleshooting.md)。

## 常见误区
- **误区 1：把仓库当成一个统一 UI。** 实际上当前主线只有 WebClipper，历史 App 仅保留归档资料。
- **误区 2：把 Notion 当成唯一事实源。** 对扩展来说，Notion 只是本地会话库的一个输出面；本地事实源仍然是 IndexedDB 与浏览器本地存储。
- **误区 3：只看 README 就开始改代码。** 这个仓库大量关键约束在 `AGENTS.md`、产品线 `AGENTS.md` 和专项文档里。

## 来源引用（Source References）
- `README.md`
- `AGENTS.md`
- `webclipper/package.json`
- `webclipper/wxt.config.ts`
- `webclipper/src/entrypoints/background.ts`
- `webclipper/src/entrypoints/content.ts`
- `webclipper/src/entrypoints/video-transcript-interceptor.content.ts`
- `webclipper/src/entrypoints/video-transcript-bridge.content.ts`
- `webclipper/src/ui/comments/react/ThreadedCommentsPanel.tsx`
- `webclipper/src/ui/comments/react/panel-store.ts`
- `webclipper/src/ui/comments/react/focus-rules.ts`
- `webclipper/src/services/comments/domain/comment-metrics.ts`
- `webclipper/src/services/bootstrap/video-transcript-capture.ts`
- `webclipper/src/ui/settings/sections/VideosSection.tsx`
- `webclipper/src/ui/settings/SettingsScene.tsx`
- `webclipper/src/ui/settings/SettingsTopTabsNav.tsx`
- `webclipper/src/ui/conversations/CapturedListPaneShell.tsx`
- `webclipper/src/ui/conversations/ConversationsScene.tsx`
- `webclipper/src/ui/popup/PopupShell.tsx`
- `webclipper/src/ui/app/AppShell.tsx`
- `webclipper/src/services/comments/background/handlers.ts`
- `webclipper/src/services/comments/data/storage-idb.ts`
- `webclipper/src/services/sync/notion/notion-sync-orchestrator.ts`
- `webclipper/src/services/sync/obsidian/obsidian-markdown-writer.ts`
- `webclipper/src/services/sync/backup/export.ts`
- `webclipper/src/services/sync/backup/import.ts`
- `webclipper/src/services/sync/backup/backup-utils.ts`
- `webclipper/src/ui/conversations/ConversationListPane.tsx`
- `webclipper/src/ui/shared/SelectMenu.tsx`
- `webclipper/src/viewmodels/settings/insight-stats.ts`
- `.github/workflows/release.yml`
- `.github/workflows/webclipper-release.yml`

## 更新记录（Update Notes）
- 2026-04-18：补充视频字幕采集入口与会话落点的概览说明，确保 `VideosSection`、`video` kind 和 `SyncNos-Videos` 都能从总览页路由出去。
- 2026-04-04：同步 2026-04 重大架构变化——评论模块 React 迁移、Settings 顶部标签导航、AppShell listShell 重构、Notion/Obsidian 评论数同步、文章提取增强（bilibili 新增、小红书移除）。
