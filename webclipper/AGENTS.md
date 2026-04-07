# 仓库指南

SyncNos WebClipper 是一个基于 WebExtensions（MV3）的浏览器扩展：抓取网页/AI 对话并保存到本地数据库，支持导出/备份/恢复，以及**手动**同步到 Notion / Obsidian。默认 local-first，不在后台自动把内容推到 Notion。

## 项目结构

- `webclipper/src/ui/**`：UI（popup/app/inpage），只放组件/样式/DOM 面板；Inpage 相关设置集中在 `src/ui/settings/sections/InpageSection.tsx`，包括阅读风格和 anti-hotlink 域名编辑器
- `webclipper/src/viewmodels/**`：ViewModel（hooks/context），只做 UI 状态编排与调用 service
- `webclipper/src/services/**`：Service（用例/业务流程），承接平台交互与业务逻辑
- `webclipper/src/platform/**`：平台适配（runtime/ports/storage/webext 等）
- `webclipper/src/collectors/**`：站点采集规则（content-side DOM 解析）

## 分层与依赖方向（强约束）

- 依赖方向：`ui -> viewmodels -> services -> (platform, domain, client, sync, shared, ...)`
- 禁止反向依赖：`services` 不得 import `ui/viewmodels`
- 禁止平台直连：`ui/**` 与 `viewmodels/**` 不得 import `platform/**`
- 业务与 UI 解耦：可复用业务算法/数据处理必须下沉到 `services/**`（或更底层的 domain/client 模块）

边界自检（手动）：

- `rg -n "src/platform|/platform/" webclipper/src/ui`
- `rg -n "src/platform|/platform/" webclipper/src/viewmodels`

## TypeScript 路径别名（约定）

> 目的：减少重排过程中的 `../../..`，并保证 `tsc` / WXT(Vite) / Vitest / IDE 解析一致。

- `@ui/*` -> `webclipper/src/ui/*`
- `@viewmodels/*` -> `webclipper/src/viewmodels/*`
- `@services/*` -> `webclipper/src/services/*`
- `@platform/*` -> `webclipper/src/platform/*`
- `@collectors/*` -> `webclipper/src/collectors/*`
- `@entrypoints/*` -> `webclipper/src/entrypoints/*`
- `@i18n/*` -> `webclipper/src/ui/i18n/*`

自检（手动）：

- `rg -n "@platform/" webclipper/src/ui webclipper/src/viewmodels`

## 重构期间的 bug 记录

- 仅记录、默认不在本次重构中顺手修复：
  - `.github/features/webclipper-layered-refactor/bugfix.md`

## 开发与验证

```bash
npm --prefix webclipper install
npm --prefix webclipper run dev          # WXT 开发（Chrome）
npm --prefix webclipper run compile      # tsc --noEmit
npm --prefix webclipper run test         # vitest（如存在）
npm --prefix webclipper run build        # 构建产物
npm --prefix webclipper run check        # 产物校验（manifest/icons 等）
```

## UI 圆角规范（Concentric Radius）

- 圆角 token 真源：`webclipper/src/ui/styles/tokens.css`（`--radius-outer/card/control/chip/inline/pill`）。
- UI 规范细则：`webclipper/src/ui/AGENTS.md` 的 `B2.2 · 同心圆角分级`。
- 约束：新增样式禁止写裸 `border-radius: <px>`，默认使用 `--radius-*`；按钮禁止使用 `999px`/圆形语义，pill 仅用于非按钮元素。
- 白名单：`border-radius: 0`（reset）与 `webclipper/src/ui/example.html`（示例页）可保留固定值，其余路径需收敛到 token。
- 扫描命令：
  - `rg -n "border-radius:\s*[0-9]|tw-rounded-\[" webclipper/src/ui webclipper/src/entrypoints`
  - `rg -n -- "--radius-" webclipper/src/ui/styles/tokens.css`

## Markdown 阅读风格协议

- 协议真源：
  - `webclipper/src/services/protocols/markdown-reading-profiles.ts`
  - `webclipper/src/ui/shared/markdown-reading-profile-presets.ts`
  - `webclipper/src/services/protocols/markdown-reading-profile-storage.ts`
- 存储键：`markdown_reading_profile_v1`
- 默认与回退：任何未知值都必须 `normalize -> medium`，禁止直接把脏值传入 UI。
- 扩展顺序：先改协议与测试，再加 preset，最后接 settings / 运行时消费链；不要直接在 `ChatMessageBubble` 写新分支。
- UI 实现约束：
  - `ChatMessageBubble` 保持“结构层 + profile 排版层”两层组合，不改 markdown 语义输出。
  - `ConversationDetailPane` 仅消费规范化 profile 值，不自行解析 profile 逻辑。

## Anti-hotlink 规则协议

- 规则真源：
  - `webclipper/src/platform/webext/anti-hotlink-rules-store.ts`
  - `webclipper/src/services/integrations/anti-hotlink/anti-hotlink-settings.ts`
  - `webclipper/src/ui/settings/sections/AntiHotlinkDomainsEditor.tsx`
- 存储键：`anti_hotlink_rules_v1`
- 默认规则：`cdnfile.sspai.com -> https://sspai.com/`、`sns-webpic-qc.xhscdn.com -> https://www.xiaohongshu.com/`
- 行为边界：当 article 图片命中规则时，抓取链路会自动补 referer 并缓存图片；即使 `web_article_cache_images_enabled` 关闭，也不能让主抓取失败。
- UI 接入链路：设置页的 Inpage 分区；不要把规则编辑散落到别的设置页。

## 会话分页与定位契约

- 会话列表主链路必须走分页接口：`bootstrap + loadMore`，禁止回退全量 `listConversations` 读取。
- `ConversationListPane` 的 near-bottom 自动加载由 sentinel + `IntersectionObserver` 触发；需要用 `loadingInitialList/loadingMoreList/listHasMore` 闸门防重入。
- 列表筛选与统计口径必须来自 provider 的 `listFacets/listSummary`，不要从当前已加载子集反推统计。
- `Select All` 仅作用“当前已加载且可见项”；批量 `Delete/Export/Sync` 提示文案必须明确同一范围语义。
- deep-link `loc`、Insight 跳转与外部打开必须走 provider 精确打开链路（`openConversationExternalByLoc/openConversationExternalBySourceKey/openConversationExternalById`），不能再依赖 `items.find()`。
- 窄屏 list/detail 桥接使用 `pending-open.ts` 的一次性 `sessionStorage` payload（`conversationId` 必填，可附带 `source + conversationKey`）；消费后立即删除，避免重复复用旧目标。

## `$` mention（在其他 AI chats 输入框插入本地 item）

- 开关：`ai_chat_dollar_mention_enabled`（`Settings → General`，默认 `true`）。该开关由 `src/services/bootstrap/content-controller.ts` 监听 `chrome.storage.onChanged`，通常可在当前标签页热更新启停；但若当前页面未启动 content controller（例如 `inpage_display_mode=off`），仍需刷新页面或重新进入支持站点。
- 支持站点：以 `src/collectors/ai-chat-sites.ts` 的 `SUPPORTED_AI_CHAT_SITES[].features.dollarMention === true` 为真源；当前包括：
  - ChatGPT（`chatgpt.com`, `www.chatgpt.com`, `chat.openai.com`）
  - Claude（`claude.ai`）
  - Gemini（`gemini.google.com`）
  - Google AI Studio（`aistudio.google.com`, `makersuite.google.com`）
  - DeepSeek（`chat.deepseek.com`）
  - Kimi（`kimi.moonshot.cn`, `kimi.com`）
  - Doubao（`doubao.com`）
  - Yuanbao（`yuanbao.tencent.com`）
  - Poe（`poe.com`）
  - Notion AI（`notion.so`）
  - z.ai（`chat.z.ai`）
- 触发：输入框出现 `$` 即弹出候选窗；继续输入实时过滤。
- 候选：范围为本地 conversations（chat + article）；过滤字段固定为标题/来源/URL 域名；仅 `$` 时按最近保存时间倒序。
- 键盘：`↑/↓` 移动高亮，`Tab/Enter` 选中并插入，`Esc` 仅关闭候选窗且保留输入文本。
- 插入：替换本次触发片段（`$query`），并在光标位置插入；插入文本与“Copy full markdown”同源，且不做截断。

## 贡献约定

- 默认不查看、不编辑 i18n 字段（除非明确要求）。
- Commit message 用 Conventional Commits（如 `refactor:`/`feat:`/`fix:`），一次改动尽量做到可编译、可回滚。
- 重构优先拆成可独立验证的小步：每步至少跑 `npm --prefix webclipper run compile`。
