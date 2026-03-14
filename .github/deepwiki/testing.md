# 测试

## 测试策略

| 产品线 / 层 | 主策略 | 自动化程度 | 核心目标 |
| --- | --- | --- | --- |
| SyncNos App | 构建校验 + SwiftUI Preview + 人工冒烟 | 低到中 | 保障来源读取、门控、同步、窗口行为不回退 |
| WebClipper | `compile` → `test` → `build`（必要时补 `build:firefox` / `check`） | 中到高 | 保障消息协议、存储迁移、同步游标、构建产物稳定 |
| 发布层 | workflow 校验 + 打包脚本 | 高 | 保障 tag / manifest / 资产生成与上传一致 |

## SyncNos App：验证重点

| 场景 | 推荐方法 | 关注点 |
| --- | --- | --- |
| 工程可构建 | `xcodebuild -project macOS/SyncNos.xcodeproj -scheme SyncNos -configuration Debug build` | 工程、依赖和 Swift 编译是否正常 |
| 引导 / 付费墙 / 主界面切换 | `RootView` 相关 Preview + 手动打开 App | 确认 Onboarding → PayWall → MainListView 顺序不乱 |
| ViewModel / Service 核心逻辑 | 单元测试或最小 mock 验证 | 数据转换、状态变化、边界条件 |
| 同步冒烟 | 连接至少一个来源并完成一次同步 | Notion 中出现对应数据库 / 页面 |
| 键盘 / 焦点 / 窗口行为 | 参考专项文档手工验证 | 主窗口、搜索、快捷键和菜单栏模式不串场 |

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
| `tests/storage/schema-migration.test.ts` | IndexedDB v2 / v4 迁移：NotionAI stable key 与 article canonical key 归并 | 直接关系到旧数据升级与 mapping 延续 |
| `tests/storage/conversations-idb.test.ts` | conversations / messages 的本地持久化 | 确认 UI 和同步层读到的事实源正确 |
| `tests/storage/insight-stats.test.ts` | Insight 聚合：空库、chat/article 混合、Unknown 域名、Top N 折叠、Top 3 对话排序 | 防止本地统计页把“事实源”算错或把尾部来源错误归桶 |
| `tests/unit/markdown-renderer.test.ts` | 消息渲染与 markdown 输出 | 防止 UI 与导出文本回归 |
| `tests/collectors/gemini-collector.test.ts` | 过滤隐藏说话人 / 状态文案、blob 上传图片内联 | 防止 Gemini 页面结构变化把噪音文案或上传图片误写入正文 |
| `tests/collectors/kimi-collector.test.ts`, `tests/collectors/zai-collector.test.ts` | 用户上传附件卡片图片抓取 | 防止附件图片只出现在页面而未进入本地会话 markdown |
| `tests/smoke/background-router-current-page-capture.test.ts` | popup 当前页抓取与 background relay | 保证当前页抓取不会只在 UI 上“看起来能点” |
| `tests/smoke/detail-header-actions.test.ts`, `tests/smoke/app-detail-header-actions.test.ts` | Notion / Obsidian / Chat with AI 详情头动作解析（含 clipboard + external jump） | 直接影响用户最常点击的打开 / 跳转入口 |
| `tests/unit/settings-sections.test.ts` | Settings 分组与 section 顺序（`Features = general + chat_with`，`About = insight + about`） | 防止 Settings 导航回退或新分区被错误挪位 |

## 手动冒烟建议
1. **App**：打开应用、确认主窗口 / Settings / Logs 都可打开；走一遍 onboarding / paywall 正常路径；至少连接一个来源并完成一次同步。
2. **WebClipper（支持站点）**：在支持 AI 站点验证自动采集、单击保存、双击打开 popup、多击提示、popup 列表刷新。
3. **WebClipper（普通网页）**：抓一次 article，确认能写出 article conversation，并尝试同步到 Notion 或导出 Markdown。
4. **WebClipper（配置）**：验证 Notion Parent Page、Obsidian connection test、备份导出 / 导入、`General` 分区里的 `theme mode / inpage display mode / AI auto-save` 保存与刷新行为。
5. **WebClipper（Chat with AI）**：在 article 或 chat detail 中验证启用平台是否出现在 header；点击后应先复制 payload，再打开目标站点；长内容应按 `maxChars` 截断。
6. **WebClipper（Insight）**：打开 `Settings → Insight`，验证 overview cards、来源分布、Top 3 longest conversations、文章域名分布都能渲染；空库应显示空态，IndexedDB 读取失败应显示错误态；在窄屏下从排行点击对话应能进入 detail；从列表底部 `today/total` 统计点击也应能跳转到 Insight 分区。
7. **WebClipper（列表筛选下拉）**：在 popup 与 app 的会话列表底部分别打开 `source` / `site` 筛选菜单，确认菜单高度会随可视区域自适应；空间不足时出现可控滚动，空间充足时不出现无谓滚动条，也不应被底部容器裁切。
8. **发布前**：确认 `manifest.version`、workflow、打包脚本参数和 tag 规则一致。

## 发布前检查

| 检查项 | 先看哪里 | 期望 |
| --- | --- | --- |
| manifest 版本与 tag 一致 | `wxt.config.ts`, `webclipper-amo-publish.yml`, `webclipper-cws-publish.yml` | tag 去掉 `v` 后与 `1.3.1` 对齐 |
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
- 需要真的跑代码时，优先遵循仓库已有的命令，不新增新的 lint / test 系统。

## 来源引用（Source References）
- `AGENTS.md`
- `macOS/SyncNos/AGENTS.md`
- `macOS/SyncNos/Views/RootView.swift`
- `.github/docs/键盘导航与焦点管理技术文档（全项目）.md`
- `webclipper/package.json`
- `webclipper/tests`
- `webclipper/tests/unit/notion-sync-cursor.test.ts`
- `webclipper/tests/storage/schema-migration.test.ts`
- `webclipper/tests/storage/conversations-idb.test.ts`
- `webclipper/tests/storage/insight-stats.test.ts`
- `webclipper/tests/collectors/gemini-collector.test.ts`
- `webclipper/tests/collectors/kimi-collector.test.ts`
- `webclipper/tests/collectors/zai-collector.test.ts`
- `webclipper/tests/unit/markdown-renderer.test.ts`
- `webclipper/tests/smoke/background-router-current-page-capture.test.ts`
- `webclipper/tests/smoke/detail-header-actions.test.ts`
- `webclipper/tests/smoke/app-detail-header-actions.test.ts`
- `webclipper/tests/unit/settings-sections.test.ts`
- `webclipper/src/integrations/chatwith/chatwith-detail-header-actions.ts`
- `webclipper/src/ui/shared/hooks/useThemeMode.ts`
- `webclipper/src/ui/shared/SelectMenu.tsx`
- `webclipper/src/ui/conversations/ConversationListPane.tsx`
- `webclipper/src/ui/settings/sections/InsightSection.tsx`
- `webclipper/src/ui/settings/sections/insight-stats.ts`
- `.github/workflows/webclipper-amo-publish.yml`
- `.github/workflows/webclipper-cws-publish.yml`
