# SyncNos Chrome 插件（多平台分阶段）实施计划

> 执行方式：建议使用`executing-plans` 按批次实现与验收。

**Goal（目标）:** 在不依赖 SyncNos App 的前提下，交付一个可独立运行的 Chrome 插件，先打通 `ChatGPT + NotionAI` 的自动入库/手动导出/手动同步 Notion 闭环，并预留多平台扩展能力。

**Non-goals（非目标）:** 本计划不包含 Safari 正式发布、不包含历史版本分支管理、不包含复杂自定义字段映射编辑器。

**Approach（方案）:** 以 `Resource/demo/js` 的能力实现为参考，但不绑定其分层目录；本项目采用“按能力分包”组织：`collectors`、`storage`、`sync`、`export`、`ui`、`shared`。数据模型从首版起支持 `sourceType`（`chat | article`），保证后续网页文章 fetch 无需重构主链路。先完成 P1 本地闭环，再在 P2 接入 Notion OAuth 与同步，P3 分批接入更多平台并加入 article fetch，P4 做发布与迁移。全程坚持最小权限、增量写入、可回归验证。

**Acceptance（验收）:**
- P1：`ChatGPT + NotionAI` 可自动增量入库，支持多选/全选导出 `JSON + Markdown`。
- P2：OAuth 生效，Parent Page 选择可用，按来源自动建库并可批量同步，失败不阻断。
- P3：新增平台按统一适配器接入，满足采集/入库/导出/同步四项基本能力，并具备网页文章 fetch 扩展能力。
- P4：权限最小化、发布材料完整，具备 Safari 转换前提。

---

## Plan A（主方案）

### P1（最高优先级）：本地采集与管理闭环（ChatGPT + NotionAI）

### Task 1: 创建插件工程骨架（按能力分包）

**Files:**
- Create: `Extensions/WebClipper/manifest.json`
- Create: `Extensions/WebClipper/src/bootstrap/background.js`
- Create: `Extensions/WebClipper/src/collectors/runtime-observer.js`
- Create: `Extensions/WebClipper/src/storage/incremental-updater.js`
- Create: `Extensions/WebClipper/src/shared/normalize.js`
- Create: `Extensions/WebClipper/src/collectors/chatgpt-collector.js`
- Create: `Extensions/WebClipper/src/collectors/notionai-collector.js`
- Create: `Extensions/WebClipper/src/bootstrap/content.js`
- Create: `Extensions/WebClipper/src/ui/popup/popup.js`
- Create: `Extensions/WebClipper/src/ui/popup/popup.html`
- Create: `Extensions/WebClipper/src/ui/inpage/inpage.css`
- Create: `Extensions/WebClipper/src/ui/popup/popup.css`
- Create: `Extensions/WebClipper/icons/`（SyncNos logo）

**Step 1: 实现功能**
- 参考 `Resource/demo/js` 的能力实现，按本计划定义的能力分包目录搭建插件工程。
- 仅保留当前阶段需要的模块；不复制多平台适配器和无关页面。
- `manifest.json` 仅声明 `chatgpt.com`、`chat.openai.com`、`notion.so/chat` 所需权限。

**Step 2: 验证**
Run: 在 `chrome://extensions` 加载 `Extensions/WebClipper`。
Expected: 扩展可加载，无 manifest 权限报错。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper`
Run: `git commit -m "chore: scaffold webclipper extension"`

### Task 2: 实现统一数据模型与 IndexedDB 表结构

**Files:**
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`
- Create: `Extensions/WebClipper/src/storage/schema.js`

**Step 1: 实现功能**
- 定义 `conversations`、`messages`、`sync_mappings` 三类存储。
- conversation 字段包含：`sourceType`（`chat|article`）、`source`、`conversationKey`、`warningFlags`、`notionPageId`、`lastCapturedAt`。
- message 字段包含：`messageKey`、`conversationId`、`role`、`contentText`、`sequence`、`updatedAt`。
- 建立关键索引：`source+conversationKey`、`conversationId+sequence`、`conversationId+messageKey`。

**Step 2: 验证**
Run: `node --check Extensions/WebClipper/src/bootstrap/background.js`
Expected: 语法通过；首次加载扩展后 IndexedDB 创建成功（DevTools Application 面板可见对象仓库）。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper/src/bootstrap/background.js Extensions/WebClipper/src/storage/schema.js`
Run: `git commit -m "feat: add indexeddb schema for conversations and messages"`

### Task 3: 搭建 background 消息路由与 CRUD 接口

**Files:**
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`

**Step 1: 实现功能**
- 建立 runtime message 协议：`upsertConversation`、`upsertMessagesIncremental`、`getConversations`、`deleteConversation`、`clearAll`。
- 写入策略：message `messageKey` 冲突时覆盖，不新增重复。
- 返回统一结果结构：`{ ok, data, error }`。

**Step 2: 验证**
Run: `node --check Extensions/WebClipper/src/bootstrap/background.js`
Expected: 语法通过；content/popup 调用接口时可收到一致响应结构。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper/src/bootstrap/background.js`
Run: `git commit -m "feat: implement background message router and CRUD APIs"`

### Task 4: 迁移并收敛 core 层（增量比对与去重）

**Files:**
- Modify: `Extensions/WebClipper/src/collectors/runtime-observer.js`
- Modify: `Extensions/WebClipper/src/storage/incremental-updater.js`
- Modify: `Extensions/WebClipper/src/shared/normalize.js`

**Step 1: 实现功能**
- 参考 `Resource/demo/js/core/base.js` 保留 `MutationObserver + debounce` 主流程。
- 去重改为：优先页面 messageId；缺失时使用 `role + textHash + sequence` 回退。
- 仅保留与当前阶段相关的逻辑，删除多平台特化分支。

**Step 2: 验证**
Run: `node --check Extensions/WebClipper/src/collectors/runtime-observer.js`
Run: `node --check Extensions/WebClipper/src/storage/incremental-updater.js`
Run: `node --check Extensions/WebClipper/src/shared/normalize.js`
Expected: 语法通过；消息变化检测能区分新增/更新/删除。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper/src`
Run: `git commit -m "feat: adapt core incremental pipeline for SyncNos rules"`

### Task 5: 接入 ChatGPT 适配器与页面按钮

**Files:**
- Modify: `Extensions/WebClipper/src/collectors/chatgpt-collector.js`
- Modify: `Extensions/WebClipper/src/bootstrap/content.js`
- Modify: `Extensions/WebClipper/src/ui/inpage/inpage.css`

**Step 1: 实现功能**
- 参考 `Resource/demo/js/adapters/chatgpt.js` 提取结构，并对齐当前已确认的数据模型。
- 页面按钮策略：右下角固定+可拖拽。
- 触发链路：自动保存默认开启，手动按钮触发一次即时采集。

**Step 2: 验证**
Run: `node --check Extensions/WebClipper/src/collectors/chatgpt-collector.js`
Manual: 打开 ChatGPT 对话，新增消息后观察本地会话消息数递增。
Expected: 不重复写入、顺序正确、按钮可拖拽。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper/src/collectors/chatgpt-collector.js Extensions/WebClipper/src/bootstrap/content.js Extensions/WebClipper/src/ui/inpage/inpage.css`
Run: `git commit -m "feat: add chatgpt adapter and floating action button"`

### Task 6: 接入 NotionAI 适配器（三形态 + 黄色警告）

**Files:**
- Modify: `Extensions/WebClipper/src/collectors/notionai-collector.js`
- Modify: `Extensions/WebClipper/src/bootstrap/content.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`

**Step 1: 实现功能**
- 基于现有 NotionAI 油猴提取逻辑实现“严格聊天容器根节点”采集。
- 支持三形态：侧边栏、右下角浮窗、全屏。
- 容器置信度不足时打 `container_low_confidence`，会话仍入库。
- 页面按钮靠近窗口标题右侧（左上区域）。

**Step 2: 验证**
Run: `node --check Extensions/WebClipper/src/collectors/notionai-collector.js`
Manual: 在 NotionAI 三形态分别发消息并检查入库；验证不混入主页笔记。
Expected: 三形态都可采集；低置信度会话带黄色警告标记。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper/src/collectors/notionai-collector.js Extensions/WebClipper/src/bootstrap/content.js Extensions/WebClipper/src/bootstrap/background.js`
Run: `git commit -m "feat: add notionai adapter with strict container and warning flags"`

### Task 7: 完成 popup 列表、多选、全选、导出（JSON+Markdown）

**Files:**
- Modify: `Extensions/WebClipper/src/ui/popup/popup.html`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.css`
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`

**Step 1: 实现功能**
- 参考 `Resource/demo/js/popup.js`，保留会话列表和多选交互。
- 全选包含黄色警告会话。
- 导出格式：JSON、Markdown（可单独导出或批量导出）。

**Step 2: 验证**
Run: `node --check Extensions/WebClipper/src/ui/popup/popup.js`
Manual: 勾选多会话导出两种格式，检查文件内容与会话数量一致。
Expected: 导出成功，格式正确，黄色警告项可被全选。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper/src/ui/popup/popup.html Extensions/WebClipper/src/ui/popup/popup.js Extensions/WebClipper/src/ui/popup/popup.css Extensions/WebClipper/src/bootstrap/background.js`
Run: `git commit -m "feat: implement popup multi-select and json/markdown export"`

### Task 8: 删除与清空能力

**Files:**
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.js`

**Step 1: 实现功能**
- 支持会话级删除。
- 支持清空全部数据（会话、消息、映射）。
- 删除后刷新列表和存储统计。

**Step 2: 验证**
Manual: 删除单会话后刷新 popup；执行清空后列表为空。
Expected: 删除准确，清空彻底，无残留脏记录。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper/src/bootstrap/background.js Extensions/WebClipper/src/ui/popup/popup.js`
Run: `git commit -m "feat: add conversation deletion and clear-all actions"`

### Task 9: P1 回归验证

**Files:**
- Modify: `.github/docs/Chrome插件-ChatGPT-NotionAI-MVP-需求汇总.md`

**Step 1: 实现功能**
- 将 P1 验收结果补充到文档（通过/失败/问题单）。

**Step 2: 验证**
Manual:
- ChatGPT 自动保存通过。
- NotionAI 三形态自动保存通过。
- 多选+全选+导出通过。
- 删除/清空通过。
Expected: P1 清单全项可复现。

**Step 3: 小步提交**
Run: `git add .github/docs/Chrome插件-ChatGPT-NotionAI-MVP-需求汇总.md`
Run: `git commit -m "docs: record p1 validation results"`

---

### P2：Notion 同步闭环（OAuth + Parent Page + 自动建库）

### Task 10: OAuth 数据结构与设置页入口

**Files:**
- Create: `Extensions/WebClipper/src/sync/notion/oauth-config.js`
- Create: `Extensions/WebClipper/src/sync/notion/oauth-client.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.html`

**Step 1: 实现功能**
- 增加 OAuth 配置结构（clientId、redirectUri、scopes）。
- popup 增加“连接 Notion”入口和连接状态展示。

**Step 2: 验证**
Run: `node --check Extensions/WebClipper/src/sync/notion/oauth-client.js`
Manual: 点击连接按钮能拉起 Notion 授权页。
Expected: 授权流程可启动，UI 状态可更新。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper/src/sync/notion Extensions/WebClipper/src/ui/popup/popup.js Extensions/WebClipper/src/ui/popup/popup.html`
Run: `git commit -m "feat: add notion oauth entry and client modules"`

### Task 11: OAuth 回调桥接与 token 持久化

**Files:**
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`
- Create: `Extensions/WebClipper/src/sync/notion/token-store.js`

**Step 1: 实现功能**
- 对接回调页 `https://chiimagnus.github.io/syncnos-oauth/callback` 的返回参数。
- 处理 code 交换结果并持久化 access token（插件本地安全存储）。

**Step 2: 验证**
Manual: 完成一次授权并重开浏览器。
Expected: 连接状态保持有效，token 可读取。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper/src/bootstrap/background.js Extensions/WebClipper/src/sync/notion/token-store.js`
Run: `git commit -m "feat: persist notion oauth token and callback handling"`

### Task 12: Parent Page 列表与选择

**Files:**
- Create: `Extensions/WebClipper/src/sync/notion/notion-api.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.html`

**Step 1: 实现功能**
- 实现 Parent Page 列表拉取。
- popup 提供选择与保存，保存 `parentPageId`。

**Step 2: 验证**
Manual: 能看到页面列表并选中目标父页面。
Expected: 选中后刷新 popup，配置仍存在。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper/src/sync/notion/notion-api.js Extensions/WebClipper/src/ui/popup/popup.js Extensions/WebClipper/src/ui/popup/popup.html`
Run: `git commit -m "feat: add notion parent page selection"`

### Task 13: 按来源 ensure 数据库（ChatGPT / NotionAI）

**Files:**
- Create: `Extensions/WebClipper/src/sync/notion/notion-db-manager.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`

**Step 1: 实现功能**
- 按来源维护两个数据库映射。
- 流程：读取缓存 -> 校验存在 -> 搜索同名 -> 创建新库。

**Step 2: 验证**
Manual: 首次同步时自动建库；第二次同步复用已建库。
Expected: 不重复创建同名数据库。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper/src/sync/notion/notion-db-manager.js Extensions/WebClipper/src/bootstrap/background.js`
Run: `git commit -m "feat: ensure per-source notion databases"`

### Task 14: 会话同步服务（覆盖同页）

**Files:**
- Create: `Extensions/WebClipper/src/sync/notion/notion-sync-service.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.js`

**Step 1: 实现功能**
- 同步粒度：`1 会话 -> 1 页面`。
- 若会话已有 `notionPageId`：覆盖更新页面内容；否则创建页面并写回映射。
- 字段固定：`Name`、`Date`、`URL`。

**Step 2: 验证**
Manual: 同一会话连续同步两次。
Expected: 只更新同一页面，不新增重复页面。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-service.js Extensions/WebClipper/src/bootstrap/background.js Extensions/WebClipper/src/ui/popup/popup.js`
Run: `git commit -m "feat: sync conversations to notion with overwrite semantics"`

### Task 15: 批量同步执行器与失败清单

**Files:**
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.js`

**Step 1: 实现功能**
- 批量同步不中断策略。
- 结果输出：成功数、失败数、失败会话列表。

**Step 2: 验证**
Manual: 人为制造部分失败（无权限页面/网络异常）执行批量同步。
Expected: 其余会话继续同步，最终弹出失败清单。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper/src/bootstrap/background.js Extensions/WebClipper/src/ui/popup/popup.js`
Run: `git commit -m "feat: add batch sync with non-blocking failures"`

### Task 16: P2 回归验证

**Files:**
- Modify: `.github/docs/Chrome插件-ChatGPT-NotionAI-MVP-需求汇总.md`

**Step 1: 实现功能**
- 记录 OAuth、Parent Page、自动建库、覆盖同步、失败清单验证结果。

**Step 2: 验证**
Manual: 走完完整授权与批量同步路径。
Expected: P2 验收项全通过，异常路径有明确提示。

**Step 3: 小步提交**
Run: `git add .github/docs/Chrome插件-ChatGPT-NotionAI-MVP-需求汇总.md`
Run: `git commit -m "docs: record p2 validation results"`

---

### P3：多平台扩展（批量接入）

### Task 17: 建立平台注册表与适配器模板

**Files:**
- Create: `Extensions/WebClipper/src/collectors/registry.js`
- Create: `Extensions/WebClipper/src/collectors/collector-contract.js`
- Modify: `Extensions/WebClipper/src/bootstrap/content.js`

**Step 1: 实现功能**
- 建立统一平台注册与分发机制。
- 模板约束抽象方法：URL 校验、源类型判定（chat/article）、会话键提取、消息/文章内容提取、消息元素识别。

**Step 2: 验证**
Run: `node --check Extensions/WebClipper/src/collectors/registry.js`
Expected: 页面加载时仅激活匹配平台适配器。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper/src/collectors/registry.js Extensions/WebClipper/src/collectors/collector-contract.js Extensions/WebClipper/src/bootstrap/content.js`
Run: `git commit -m "refactor: add adapter registry and template"`

### Task 18: 批次 A 平台接入（Claude / Gemini）

**Files:**
- Create: `Extensions/WebClipper/src/collectors/claude-collector.js`
- Create: `Extensions/WebClipper/src/collectors/gemini-collector.js`
- Modify: `Extensions/WebClipper/manifest.json`

**Step 1: 实现功能**
- 参考 `Resource/demo/js/adapters/claude.js` 与 `Resource/demo/js/adapters/gemini.js` 迁移。
- 对齐当前数据模型与去重策略。

**Step 2: 验证**
Run: `node --check Extensions/WebClipper/src/collectors/claude-collector.js`
Run: `node --check Extensions/WebClipper/src/collectors/gemini-collector.js`
Manual: 在两个平台分别验证采集/导出/同步。
Expected: 满足四项基本能力。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper/src/collectors/claude-collector.js Extensions/WebClipper/src/collectors/gemini-collector.js Extensions/WebClipper/manifest.json`
Run: `git commit -m "feat: add claude and gemini adapters"`

### Task 19: 批次 B/C 平台接入（DeepSeek/Kimi/Doubao/Yuanbao）

**Files:**
- Create: `Extensions/WebClipper/src/collectors/deepseek-collector.js`
- Create: `Extensions/WebClipper/src/collectors/kimi-collector.js`
- Create: `Extensions/WebClipper/src/collectors/doubao-collector.js`
- Create: `Extensions/WebClipper/src/collectors/yuanbao-collector.js`
- Modify: `Extensions/WebClipper/manifest.json`

**Step 1: 实现功能**
- 按批次接入并逐个平台完成调试。
- 每个平台复用相同的存储/导出/同步管线。

**Step 2: 验证**
Manual: 每平台至少完成一次采集、一次导出、一次同步。
Expected: 平台可用且不影响已接入平台。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper/src/collectors Extensions/WebClipper/manifest.json`
Run: `git commit -m "feat: add remaining platform adapters"`

### Task 20A: 网页文章 fetch 扩展骨架

**Files:**
- Create: `Extensions/WebClipper/src/collectors/article-fetcher.js`
- Create: `Extensions/WebClipper/src/export/article-markdown.js`
- Modify: `Extensions/WebClipper/src/collectors/collector-contract.js`
- Modify: `Extensions/WebClipper/src/bootstrap/content.js`

**Step 1: 实现功能**
- 新增文章采集器骨架：提取标题、作者、发布时间、正文文本、来源 URL。
- 将文章采集结果写入统一存储模型（`sourceType=article`）。
- 导出层新增文章 Markdown 格式化器（与聊天导出并存）。

**Step 2: 验证**
Run: `node --check Extensions/WebClipper/src/collectors/article-fetcher.js`
Run: `node --check Extensions/WebClipper/src/export/article-markdown.js`
Manual: 在任意文章页执行一次手动抓取并导出 Markdown。
Expected: 文章可入库，导出文件结构正确且不影响聊天流程。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper/src/collectors/article-fetcher.js Extensions/WebClipper/src/export/article-markdown.js Extensions/WebClipper/src/collectors/collector-contract.js Extensions/WebClipper/src/bootstrap/content.js`
Run: `git commit -m "feat: add article fetch extension scaffold"`

### Task 21: P3 回归验证与平台启用清单

**Files:**
- Modify: `.github/docs/Chrome插件-ChatGPT-NotionAI-MVP-需求汇总.md`
- Create: `.github/docs/Chrome插件-平台兼容性矩阵.md`

**Step 1: 实现功能**
- 输出平台兼容性矩阵（站点、采集、导出、同步、已知问题）。
- 标注默认启用平台和灰度平台。

**Step 2: 验证**
Manual: 按矩阵抽样复测至少 3 平台。
Expected: 文档与实际行为一致。

**Step 3: 小步提交**
Run: `git add .github/docs/Chrome插件-ChatGPT-NotionAI-MVP-需求汇总.md .github/docs/Chrome插件-平台兼容性矩阵.md`
Run: `git commit -m "docs: add platform compatibility matrix"`

---

### P4：发布与跨浏览器迁移准备

### Task 22: 权限最小化与隐私文档

**Files:**
- Modify: `Extensions/WebClipper/manifest.json`
- Create: `Extensions/WebClipper/PRIVACY.md`
- Create: `Extensions/WebClipper/PERMISSIONS.md`

**Step 1: 实现功能**
- 收敛到最小 host permissions。
- 明确本地存储、导出、同步、错误日志的隐私边界。

**Step 2: 验证**
Manual: 逐站点回归，确认权限收紧后功能不回退。
Expected: 权限提示合理，核心功能仍可用。

**Step 3: 小步提交**
Run: `git add Extensions/WebClipper/manifest.json Extensions/WebClipper/PRIVACY.md Extensions/WebClipper/PERMISSIONS.md`
Run: `git commit -m "chore: harden permissions and add privacy docs"`

### Task 23: Safari 转换预演与差异清单

**Files:**
- Create: `.github/docs/Chrome到Safari迁移差异清单.md`

**Step 1: 实现功能**
- 记录 Chrome APIs 与 Safari Web Extension 差异。
- 标注必须改造项（权限、消息机制、下载能力、OAuth 回调细节）。

**Step 2: 验证**
Manual: 完成一次迁移演练检查（不要求发布）。
Expected: 差异清单可直接用于后续 Safari 任务拆解。

**Step 3: 小步提交**
Run: `git add .github/docs/Chrome到Safari迁移差异清单.md`
Run: `git commit -m "docs: add chrome-to-safari migration checklist"`

---

## 边界条件与风险清单

- NotionAI 三形态容器识别失败：必须打黄色警告，禁止静默吞错。
- URL 缺失会话：必须使用回退会话键，避免会话碎片化。
- 消息重排/懒加载：去重不得仅依赖 position。
- 批量同步失败：不得整批中断，必须输出失败清单。
- OAuth 失败/过期：必须给可重试提示，不得导致 UI 卡死。

## 回归策略

- 每完成一个优先级阶段（P1/P2/P3/P4）执行一次阶段回归。
- 回归顺序：采集 -> 入库 -> 列表/多选 -> 导出 -> 同步（若阶段包含）。
- 阶段回归结论写入 `.github/docs/Chrome插件-ChatGPT-NotionAI-MVP-需求汇总.md`。

## 不确定项（需提前确认）

- OAuth `code -> token` 的服务归属与部署（独立服务或复用现有线上能力）。
- Notion 两个来源数据库最终命名规则（需与 SyncNos 现有规则一致）。
- 多平台接入后的默认启用策略（全部启用或分级启用）。

## 交接建议

- 直接进入执行：使用 `executing-plans` 按 P1 开始实现。
- 先 review：若需调整范围或目录结构，先在此计划上标注后再开工。
