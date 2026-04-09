# Generation Metadata

## Repository State

| Field | Value |
| --- | --- |
| Repository | `chiimagnus/SyncNos` |
| Commit hash | `1c39d297dee5f050d6ebdd670963c19c808b1789` |
| Branch name | `main` (HEAD), `origin/main` |
| Generation timestamp | `2026-04-09 23:54:07 +0800` |
| Output language | 中文 |
| Generated directory | `.github/deepwiki/` |
| Update mode | Major incremental sync update |

## Page Inventory

### Core / Topic Pages
- [INDEX.md](INDEX.md)
- [business-context.md](business-context.md)
- [overview.md](overview.md)
- [architecture.md](architecture.md)
- [dependencies.md](dependencies.md)
- [data-flow.md](data-flow.md)
- [configuration.md](configuration.md)
- [testing.md](testing.md)
- [workflow.md](workflow.md)
- [api.md](api.md)
- [operations.md](operations.md)
- [security.md](security.md)
- [storage.md](storage.md)
- [release.md](release.md)
- [troubleshooting.md](troubleshooting.md)
- [glossary.md](glossary.md)

### Module Pages
- [modules/comments.md](modules/comments.md)
- [modules/syncnos-app.md](modules/syncnos-app.md)
- [modules/webclipper.md](modules/webclipper.md)

### Metadata
- [GENERATION.md](GENERATION.md)

## Asset Inventory
- `assets/repository-flow-01.svg`
- `assets/popup-screenshots.png`
- `assets/setting-screenshots.png`

## What Changed In This Update

### 重大架构变化（2026-04-02 ~ 2026-04-05，85 commits）

#### 1. 评论模块 React 迁移（~1,340 行 → ~950 行）
- **删除**：legacy DOM `render.ts`（543 行）、`threaded-comments-panel.ts` 旧渲染逻辑
- **新增**：
  - `ThreadedCommentsPanel.tsx`（~810 行）：完整 React 组件，包含 composer、threads、replies、删除确认、Chat with AI 菜单
  - `panel-store.ts`（~99 行）：外部 store，实现 `getSnapshot/subscribe` 模式
  - `focus-rules.ts`（~34 行）：保存后聚焦、回复后聚焦、pending focus 解析
  - `comment-chatwith-menu.tsx`：评论级 Chat with AI 菜单
- **行为变化**：
  - 防重入保护：`runBusyTask` + `actionInFlightRef` 防止并发竞态
  - 删除二次确认：`armedDeleteId` 模式
  - 发送后自动聚焦并滚动到目标 reply 输入框
  - 评论级 Chat with AI 复制整条线程上下文

#### 2. Settings 界面重构
- **新增**：`SettingsTopTabsNav.tsx`（窄屏顶部标签导航）
- **行为变化**：
  - 窄屏使用顶部标签导航，宽屏使用侧边栏导航
  - 支持关闭按钮返回
  - 部分设置项改为 blur 自动保存（Inpage Display Mode、Chat with AI 平台/模板/maxChars）
  - Chat with AI prompt 模板可自定义，支持 `{{article_title}}`、`{{conversation_markdown}}` 等变量

#### 3. AppShell/ConversationsScene 重构
- **删除**：`CapturedListSidebar.tsx`（123 行）
- **新增**：`CapturedListPaneShell.tsx`（~45 行）
- **行为变化**：
  - 引入 `listShell` 属性，popup/app 共享列表架构
  - 窄屏支持三路由：`list` / `detail` / `comments`
  - 评论侧边栏作为独立路由（与 detail 平级）

#### 4. Notion/Obsidian 评论数同步
- **新增**：`comment-metrics.ts`（`computeArticleCommentThreadCount`）
- **Notion**：写入 "Comment Threads" 属性（数字类型）
- **Obsidian**：frontmatter 写入 `comments_root_count`，Markdown 包含 `## Comments` 章节

#### 5. 文章提取增强
- **新增**：bilibili 动态支持（`bilibili-opus.ts`）
- **移除**：小红书适配器（`xhs-note.ts`）
- **优化**：Discourse `<details>` code blocks 处理（`markdown.ts` 新增 `normalizeDetailsElementsForMarkdown`）

#### 6. Chat with AI 改进
- prompt 模板可配置（`chatwith-settings.ts`）
- 支持 reset 平台列表功能
- 评论级 Chat with AI 菜单（整条线程上下文）

### 7. 2026-04 配置 / 存储同步
- `manifest.version` 对齐到 `1.5.3`
- `DB_VERSION` 对齐到 `8`，补齐列表分页 / 筛选索引回填
- Inpage 分区承载 `markdown_reading_profile_v1` 与 `anti_hotlink_rules_v1`
- `article` 抓取在命中 anti-hotlink 规则时会自动缓存图片，即使 web article cache toggle 关闭也不会中断主链路

### 更新的页面
- `business-context.md`：更新核心产物、用户旅程、业务规则、术语、最容易误判的点、来源引用
- `overview.md`：更新顶层目录地图、关键入口文件、来源引用
- `architecture.md`：更新内部边界表、依赖说明、来源引用
- `modules/comments.md`：**完全重写**，反映 React 迁移后的新架构

## Coverage Notes
- 本次重点是同步 2026-04 的重大架构变化：评论模块 React 迁移、Settings 重构、AppShell listShell 重构、Notion/Obsidian 评论数同步、文章提取增强，以及 1.5.3 / DB v8 / Inpage 规则事实。
- `data-flow.md`、`modules/webclipper.md`、`configuration.md`、`storage.md`、`testing.md`、`workflow.md`、`security.md`、`glossary.md` 已在本轮增量中同步。
- deepwiki 继续覆盖配置、数据流、存储、测试、发布与排障；并维持"代码/配置优先于文档摘要"的约束。

## Audit Basis

| 类别 | 主要来源 |
| --- | --- |
| 仓库入口与规范 | `AGENTS.md`, `README.md`, `README.zh-CN.md`, `webclipper/AGENTS.md` |
| 评论 React 迁移 | `webclipper/src/ui/comments/react/ThreadedCommentsPanel.tsx`, `panel-store.ts`, `focus-rules.ts`, `comment-chatwith-menu.tsx` |
| Settings 重构 | `webclipper/src/ui/settings/SettingsScene.tsx`, `SettingsTopTabsNav.tsx`, `useSettingsSceneController.ts` |
| AppShell 重构 | `webclipper/src/ui/app/AppShell.tsx`, `PopupShell.tsx`, `ConversationsScene.tsx`, `CapturedListPaneShell.tsx` |
| 评论数同步 | `webclipper/src/services/comments/domain/comment-metrics.ts`, `notion-sync-orchestrator.ts`, `obsidian-markdown-writer.ts` |
| 文章提取 | `webclipper/src/collectors/web/article-fetch-sites/bilibili-opus.ts`, `article-extract/markdown.ts` |
| Chat with AI | `webclipper/src/services/integrations/chatwith/chatwith-settings.ts`, `chatwith-comment-actions.ts` |
| Git 历史 | 85 commits since 2026-04-02 |

## Notes For Next Update
- 若 manifest、DB schema 或发布 workflow 再次变更，优先更新 `configuration.md`、`storage.md`、`release.md`，再回写索引与元数据。
- 如果后续继续演进 Inpage 规则或 markdown 阅读风格，优先同步 `webclipper/src/ui/AGENTS.md` 与 `webclipper/AGENTS.md`，再回写 deepwiki 相关页。
