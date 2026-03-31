# 测试

## 测试策略

| 产品线 / 层 | 主策略 | 自动化程度 | 核心目标 |
| --- | --- | --- | --- |
| WebClipper | `compile` → `test` → `build`（必要时补 `build:firefox` / `check`） | 中到高 | 保障消息协议、存储迁移、同步游标、构建产物稳定 |
| 发布层 | workflow 校验 + 打包脚本 | 高 | 保障 tag / manifest / 资产生成与上传一致 |

## WebClipper：自动化验证入口

| 命令 / 目录 | 覆盖点 | 说明 |
| --- | --- | --- |
| `npm --prefix webclipper run compile` | TypeScript 契约与调用面 | 默认验证顺序第一步 |
| `npm --prefix webclipper run test` | Vitest 单测 | 覆盖游标、IndexedDB 迁移、Markdown 等关键逻辑 |
| `npm --prefix webclipper run build` | Chrome / Edge 产物 | 验证 WXT 构建与入口配置 |
| `npm --prefix webclipper run build:firefox` | Firefox 产物 | 涉及 Firefox / 发布打包时必须补跑 |
| `npm --prefix webclipper run check` | dist 完整性 | build 后再调用 `check-dist.mjs` |
| `webclipper/tests/` | 测试分层目录 | 当前至少分为 `collectors`, `domains`, `integrations`, `smoke`, `storage`, `unit` |

## 代表性测试用例

| 文件 | 验证点 | 为什么重要 |
| --- | --- | --- |
| `tests/unit/notion-sync-cursor.test.ts` | Notion cursor 的 append / rebuild 判断 | 直接决定是否会重复写入或错误重建 |
| `tests/unit/notion-parent-pages.test.ts` | Notion Parent Page 发现：分页、过滤 database 子页面、savedPageId resolve（search miss 时回退 `GET /pages/:id`） | 防止设置页 Parent Page 下拉在空结果 / 旧选择 / 分页边界下失效 |
| `tests/storage/schema-migration.test.ts` | IndexedDB v2 / v4 / v6 迁移 + v7 article_comments store：NotionAI stable key、article canonical key 归并与 legacy 字段清理 | 直接关系到旧数据升级与 mapping 延续 |
| `tests/storage/conversations-idb.test.ts` | conversations / messages 的本地持久化 | 确认 UI 和同步层读到的事实源正确 |
| `tests/storage/article-comments-idb.test.ts` | `article_comments` 的增删改查、回复、级联删除与 orphan attachment | 确认 article 详情页的本地评论线程不丢、不串、不挂空 |
| `tests/domains/backup-service.test.ts` | Zip v2 导出 / 导入主流程、image cache 回填与 merge 行为 | 确认备份 archive 的结构、恢复和 merge 语义仍然稳定 |
| `tests/domains/backup-article-comments.test.ts` | `articleCommentsIndexPath` 与 `counts.article_comments` 的 manifest 校验 | 确认 Zip v2 清单会携带文章评论归档元数据 |
| `tests/storage/insight-stats.test.ts` | Insight 聚合：空库、chat/article 混合、Unknown 域名、Top N 折叠、Top 3 对话排序 | 防止本地统计页把“事实源”算错或把尾部来源错误归桶 |
| `tests/unit/markdown-renderer.test.ts` | 消息渲染与 markdown 输出 | 防止 UI 与导出文本回归 |
| `tests/collectors/gemini-collector.test.ts` | 过滤隐藏说话人 / 状态文案、blob 上传图片内联 | 防止 Gemini 页面结构变化把噪音文案或上传图片误写入正文 |
| `tests/collectors/kimi-collector.test.ts`, `tests/collectors/zai-collector.test.ts` | 用户上传附件卡片图片抓取 | 防止附件图片只出现在页面而未进入本地会话 markdown |
| `tests/smoke/background-router-current-page-capture.test.ts` | popup 当前页抓取与 background relay | 保证当前页抓取不会只在 UI 上“看起来能点” |
| `tests/smoke/detail-header-actions.test.ts`, `tests/smoke/app-detail-header-actions.test.ts` | Notion / Obsidian / Chat with AI 详情头动作解析（含 clipboard + external jump） | 覆盖 `open` / `chat-with` 主路径，保证详情头动作协议不回退 |
| `tests/unit/settings-sections.test.ts` | Settings 分组与 section 顺序（`Features = general + chat_with`，`Data = backup + notion + obsidian`，`About = aboutyou + aboutme`） | 防止 Settings 导航回退或新分区被错误挪位 |
| `tests/smoke/background-router-item-mention.test.ts` | `$ mention` 消息路由冒烟（search/build） | 覆盖 `ITEM_MENTION_MESSAGE_TYPES` 在 background router 的注册与输出结构 |
| `tests/unit/item-mention-search.test.ts` | `$ mention` 候选匹配与排序 | 防止标题/域名/来源匹配规则漂移导致“候选顺序看起来不对” |

## 手动冒烟建议
1. **WebClipper（支持站点）**：在支持 AI 站点验证自动采集、单击保存、双击打开页面内评论侧边栏（inpage comments panel）、多击提示；用工具栏图标打开 popup 并确认列表刷新；在输入框验证 `$ mention` 候选显示、方向键切换与 Tab/Enter 插入。
2. **WebClipper（普通网页）**：抓一次 article，确认能写出 article conversation，并尝试同步到 Notion 或导出 Markdown。
3. **WebClipper（文章评论）**：在 article detail 和 inpage comments panel 里验证评论列表、回复、删除都可用；刷新后评论仍在本地；如果从外部恢复备份，确认评论线程也能一起恢复；旧备份若不含 `assets/article-comments/index.json` 则仍会缺失。
4. **WebClipper（配置）**：验证 Notion Parent Page、Obsidian connection test、备份导出 / 导入、`General` 分区里的 `inpage display mode / AI auto-save / AI $ mention / AI chat cache images` 设置行为，以及系统主题随 `prefers-color-scheme` 切换的表现。
5. **WebClipper（详情头动作）**：在 chat detail 中验证 `tools / chat-with / open` 三组动作都能按槽位显示；`cache-images` 仅在 chat 可见、article 隐藏；触发后应看到更新计数反馈并刷新 detail；在 popup 与窄屏 header 也应保持同样行为。
6. **WebClipper（About You / Insight）**：打开 `Settings → About You`（旧称 Insight，对应 section key `aboutyou`），验证 overview cards、来源分布、Top 3 longest conversations、文章域名分布都能渲染；空库应显示空态，IndexedDB 读取失败应显示错误态；在窄屏下从排行点击对话应能进入 detail；从列表底部 `today/total` 统计点击也应能跳转到 About You 分区。
7. **WebClipper（列表筛选下拉）**：在 popup 与 app 的会话列表底部分别打开 `source` / `site` 筛选菜单，确认菜单高度会随可视区域自适应；空间不足时出现可控滚动，空间充足时不出现无谓滚动条，也不应被底部容器裁切。
8. **发布前**：确认 `manifest.version`、workflow、打包脚本参数和 tag 规则一致。

## 发布前检查

| 检查项 | 先看哪里 | 期望 |
| --- | --- | --- |
| manifest 版本与 tag 一致 | `wxt.config.ts`, `webclipper-amo-publish.yml`, `webclipper-cws-publish.yml`, `webclipper-edge-publish.yml` | 具体版本值以 `configuration.md` 为准（本页不写死） |
| Chrome / Firefox 构建均可通过 | `package.json` scripts | `build` / `build:firefox` 成功 |
| dist 引用完整 | `check-dist.mjs` | `npm run check` 通过 |
| AMO / CWS 凭据 | workflow secrets | 发布 workflow 不因凭据缺失失败 |

## 回归优先级

| 优先级 | 场景 | 原因 |
| --- | --- | --- |
| P0 | Notion 授权、Parent Page、主同步链路 | 直接决定核心价值是否交付 |
| P1 | 本地存储、Schema 迁移、备份导入导出 | 直接影响历史数据与恢复能力 |
| P1 | collectors、article fetch、消息协议 | 直接影响采集范围与 UI 可见数据 |
| P1 | Obsidian / Notion cursor 逻辑 | 直接影响增量写入与重建策略 |
| P2 | 菜单栏模式、键盘焦点、字体缩放 | 更偏体验，但很容易在桌面端回退 |

## 备注
- 本次 deepwiki 更新本身是文档改动，验证重点是“事实是否与源码 / 配置 / workflow 对齐”，而不是重新引入额外测试工具。
- `SelectMenu` 的 `adaptiveMaxHeight` / `findNearestClippingRect()` 当前主要依赖 UI 冒烟验证；如果该逻辑扩展到更多入口，建议补组件级测试覆盖 `top/bottom + clipping parent` 场景。
- `cache-images` 目前仍以手工冒烟为主（仓库内暂未发现专门单测）；若后续继续演进，建议补 `background handler + image-backfill-job + action slot` 联动测试。
- `article_comments` 相关改动，至少要跑 `tests/storage/article-comments-idb.test.ts` 与 `tests/domains/backup-article-comments.test.ts`，并做一次 article detail / inpage comments panel 的人工回归；Zip v2 现在会带回评论线程，但 legacy backup 仍可能缺少这部分元数据。
- 需要真的跑代码时，优先遵循仓库已有的命令，不新增新的 lint / test 系统。

## 来源引用（Source References）
- `webclipper/package.json`
- `webclipper/tests`
- `webclipper/tests/unit/notion-sync-cursor.test.ts`
- `webclipper/tests/storage/schema-migration.test.ts`
- `webclipper/tests/storage/conversations-idb.test.ts`
- `webclipper/tests/storage/article-comments-idb.test.ts`
- `webclipper/tests/storage/insight-stats.test.ts`
- `webclipper/tests/collectors/gemini-collector.test.ts`
- `webclipper/tests/collectors/kimi-collector.test.ts`
- `webclipper/tests/collectors/zai-collector.test.ts`
- `webclipper/tests/unit/markdown-renderer.test.ts`
- `webclipper/tests/smoke/background-router-current-page-capture.test.ts`
- `webclipper/tests/smoke/detail-header-actions.test.ts`
- `webclipper/tests/smoke/app-detail-header-actions.test.ts`
- `webclipper/tests/unit/settings-sections.test.ts`
- `webclipper/src/services/integrations/chatwith/chatwith-detail-header-actions.ts`
- `webclipper/src/services/integrations/detail-header-action-types.ts`
- `webclipper/src/ui/conversations/conversations-context.tsx`
- `webclipper/src/ui/conversations/DetailNavigationHeader.tsx`
- `webclipper/src/services/conversations/background/handlers.ts`
- `webclipper/src/services/conversations/background/image-backfill-job.ts`
- `webclipper/src/services/comments/background/handlers.ts`
- `webclipper/src/services/comments/client/repo.ts`
- `webclipper/src/services/comments/data/storage-idb.ts`
- `webclipper/src/ui/conversations/ArticleCommentsSection.tsx`
- `webclipper/src/services/comments/threaded-comments-panel.ts`
- `webclipper/src/ui/inpage/inpage-comments-panel-shadow.ts`
- `webclipper/src/services/sync/backup/export.ts`
- `webclipper/src/services/sync/backup/import.ts`
- `webclipper/src/services/sync/backup/backup-utils.ts`
- `webclipper/src/ui/settings/sections/BackupSection.tsx`
- `webclipper/src/ui/styles/tokens.css`
- `webclipper/src/ui/shared/SelectMenu.tsx`
- `webclipper/src/ui/conversations/ConversationListPane.tsx`
- `webclipper/src/ui/settings/sections/InsightSection.tsx`
- `webclipper/src/viewmodels/settings/insight-stats.ts`
- `.github/workflows/webclipper-amo-publish.yml`
- `.github/workflows/webclipper-cws-publish.yml`

## 更新记录（Update Notes）
- 2026-03-30：同步 Settings section key（`aboutyou/aboutme`）与新增 Notion Parent Page 发现链路的代表性单测入口。
- 2026-03-29：同步 inpage 双击行为为“打开页面内评论侧边栏（inpage comments panel）”，并将 `$ mention` 的测试与手动冒烟项纳入回归清单。
