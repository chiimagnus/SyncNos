# Chrome 插件（ChatGPT + NotionAI）MVP 需求汇总

## 1. 文档目的

本文件汇总当前 brainstorming 结论，作为后续插件设计与开发的单一依据。

## 2. 背景与目标

- 目标产品：独立于 SyncNos App 的 Chrome 插件（先开发者模式安装）。
- 插件目录命名：`WebClipper`（避免冗长命名）。
- 目标站点：`chatgpt.com` 与 `notion.so/chat`（NotionAI）。
- 核心目标：
  - 自动监听聊天页面 DOM 变化并增量保存到插件本地数据库。
  - 用户手动选择会话后，执行导出（JSON + Markdown）或同步到 Notion。
  - 同步模型与 SyncNos 现有 Notion 逻辑尽量一致（由系统创建数据库、按会话更新页面）。
  - 预留扩展能力：后续接入网页文章 fetch（article source）时不重构主链路。

## 3. 范围与非目标

### 3.1 当前已确认能力范围

- Chrome 扩展（Manifest V3）。
- 开发者模式本地安装。
- 本地存储使用 IndexedDB。
- 自动保存开启：DOM 变化后立即触发增量入库。
- 手动能力：
  - 会话多选与全选。
  - 批量导出 JSON/Markdown。
  - 批量同步 Notion。
- 同步失败策略：失败不阻断整批，结束后展示失败清单。

### 3.2 分阶段实施原则

- 采用 `P1 -> P2 -> P3 -> P4` 分阶段推进。
- 每个阶段都要求“可运行、可验证、可回归”，不追求一次性做完全部平台。
- 平台扩展在架构层一次设计到位，在适配层分批接入。
- 数据模型与接口从首版起支持 `sourceType`（`chat | article`），确保文章抓取可平滑接入。

### 3.3 非目标（当前阶段不做）

- Safari 版本实现（后续迁移）。
- 历史分支/版本管理（仅保留当前最新可见内容）。
- 复杂字段映射编辑器（Notion 字段固定）。

## 4. 已确认决策清单

### 4.1 数据采集与一致性

- 自动保存粒度：增量写入。
- 会话更新策略：仅保留最新可见内容，更新时覆盖本地旧内容。
- 去重主键策略：优先 `messageId`，缺失时回退到 `text hash`。
- 无会话链接时主键：`workspace + 首条用户消息哈希 + 首条时间戳`。

### 4.2 NotionAI 特殊约束

- 需支持三种形态：
  - 侧边栏
  - 右下角浮动窗
  - 全屏标准形态
- 采集策略：从“当前聊天容器根节点”向下采集，避免混入主页内容。
- 若容器定位置信度不足：
  - 不中断入库
  - 在插件 UI 对应会话标记黄色警告
- NotionAI 页面内按钮位置：
  - 依附在会话窗口左上区域
  - 靠近会话名称右侧

### 4.3 ChatGPT 页面按钮

- 固定右下角，支持拖拽。

### 4.4 导出与同步

- 导出格式：JSON + Markdown。
- Notion 同步粒度：`1 会话 -> 1 Notion 页面`。
- 重复同步同一会话：更新同一页面（覆盖为最新可见内容）。
- 批量同步：用户手动多选，提供全选。
- 全选默认包含黄色警告会话。

### 4.5 Notion 侧策略

- 鉴权方式：OAuth（本阶段不做手动 Integration Token）。
- 配置入口：选择 Notion Parent Page（页面，而非数据库）。
- 数据库策略：插件自动创建数据库。
- 数据库拓扑：按来源分两个库（ChatGPT 与 NotionAI）。
- 字段策略（固定）：`Name`、`Date`、`URL`。

### 4.6 OAuth 约束

- 插件 OAuth 必须完全不依赖用户安装 SyncNos App。
- 回调 URI 使用：`https://chiimagnus.github.io/syncnos-oauth/callback`。
- callback 页面与 App 共用，通过来源分流处理。

### 4.7 其他 UI/品牌要求

- 插件图标使用 SyncNos logo。
- 后续能力方向参考用户提供的插件截图（自动保存、存储管理、导出、关于页等）。

### 4.8 可扩展性要求

- 采集层需支持多源类型：聊天（chat）与文章（article）。
- 存储层与导出层需解耦平台实现，避免把字段耦合到聊天结构。
- 新增文章源时，最小闭环应包含：采集、入库、导出、同步四项能力。

## 5. 基础数据模型（草案）

## 5.1 Conversation

- `id`：内部主键
- `sourceType`：`chat | article`
- `source`：`chatgpt | notionai | ...`
- `conversationKey`：站点ID或回退键（无 URL 场景）
- `url`：可空
- `workspace`：可空
- `title`
- `warningFlags`：如 `container_low_confidence`
- `lastCapturedAt`
- `lastSyncedAt`：可空
- `notionPageId`：可空

## 5.2 Message

- `id`
- `conversationId`
- `messageKey`：优先 messageId，否则 hash key
- `role`：`user | assistant | system`
- `contentText`
- `contentBlocks`：结构化块（可选）
- `sequence`
- `updatedAt`

## 6. 核心流程（草案）

### 6.1 自动采集入库

1. content script 监听 DOM 变化。
2. 识别当前会话容器并抽取消息。
3. 进行增量比对（messageId/hash）。
4. 向 background 发送变更数据。
5. background 落库 IndexedDB，更新会话状态与警告标记。

### 6.2 手动导出

1. 用户在插件 UI 勾选会话（支持全选）。
2. 触发导出。
3. 生成 JSON 与 Markdown 文件并下载。

### 6.3 手动同步 Notion

1. 用户勾选会话并触发同步。
2. 以 Parent Page 为根，确保来源数据库存在。
3. 每会话定位已有页面或创建新页面。
4. 覆盖更新页面内容为当前最新可见会话内容。
5. 汇总成功/失败结果并提示。

## 7. 与现有油猴脚本关系

- 当前可运行脚本：
  - `chat_gpt-1.2.js.md`（用户提供）
  - `notionai.js.md`（用户提供）
- 可复用能力：
  - 结构化块提取（代码块/列表/表格等）。
  - Notion 分批写入思路。
- 已知问题：
  - NotionAI 侧栏/浮窗场景存在主页内容混入风险，需要容器范围收敛。

## 8. 待确认项

- OAuth `code -> token` 交换服务具体部署方案：
  - 可复用现有 SyncNos 线上能力，但必须保证对“仅安装插件用户”可独立工作。
- ChatGPT / NotionAI 两个数据库的最终命名细则（需与 SyncNos 规范一致）。

## 9. 验收口径（MVP）

- ChatGPT 与 NotionAI 会话可自动增量入库。
- NotionAI 三形态下不会混入主页正文（低置信度有黄色警告标记）。
- 插件 UI 支持多选与全选（含黄色警告项）。
- 可导出 JSON + Markdown。
- 可批量同步到 Notion；失败项不阻断并可汇总反馈。

## 10. 分阶段路线图（P1 / P2 / P3 / P4）

### 10.1 P1：本地采集与管理闭环

- 平台范围：`ChatGPT + NotionAI`。
- 核心目标：
  - 自动监听 DOM 并增量入库 IndexedDB。
  - 会话列表、多选、全选（含黄色警告项）。
  - 手动导出 `JSON + Markdown`。
  - 会话级删除与清空全部。
- 验收重点：
  - NotionAI 三形态可采集，且不混入主页内容。
  - 数据去重稳定（messageId 优先、hash 回退）。

### 10.2 P2：Notion 同步闭环

- 核心目标：
  - OAuth 登录（不依赖 SyncNos App）。
  - Parent Page 选择。
  - 自动 ensure 两个来源数据库（ChatGPT / NotionAI）。
  - 手动批量同步到 Notion（`1 会话 -> 1 页面`，重复同步覆盖同页）。
  - 失败不阻断，输出失败清单。
- 验收重点：
  - 同步结果可重复执行且不产生页面爆炸。
  - 限流与失败反馈可观测。

### 10.3 P3：多平台扩展

- 核心目标：
  - 基于统一适配器接口接入更多 AI 对话平台。
  - 每个平台满足“可采集、可入库、可导出、可同步”四项基础能力。
  - 引入网页文章 fetch 扩展骨架（article source）。
- 接入方式：
  - 优先复用 `Resource/demo/js/adapters/` 的结构与策略。
  - 保持最小权限与可测试性，不引入与目标无关功能。

### 10.4 P4：发布与跨浏览器

- 核心目标：
  - 权限最小化、隐私说明、发布准备。
  - Safari 转换与兼容修复。
  - 性能与稳定性优化。

## 11. 参考项目（`Resource/demo`）审查结论

### 11.1 可直接借鉴

- 多平台适配器分层：
  - `js/core/base.js` 作为平台无关基类。
  - `js/adapters/*.js` 只放站点专有选择器与提取逻辑。
- 自动保存主链路完整：
  - `MutationObserver + debounce + 内容比对`（`js/core/base.js`）。
  - 先提取，再判断变化，再增量写入。
- 存储层职责清晰：
  - `StorageManager` 做增量与合并策略（`js/core/storage-manager.js`）。
  - `background.js` 负责 IndexedDB 持久化与导出下载。
- 批量导出实践可复用：
  - `background.js` 使用 `chrome.downloads`。
  - 支持单文件导出与多文件打包导出（ZIP）。

### 11.2 不建议直接照搬

- 权限过宽：
  - `manifest.json` 使用 `<all_urls>` 与 `host_permissions: <all_urls>`，不符合本项目最小权限原则。
- 站点范围过大：
  - demo 同时覆盖多个平台；建议按 `P1/P2/P3` 分批接入，避免首阶段范围失控。
- 数据模型与我们目标不一致：
  - demo 主要是“本地记忆管理 + 文本导出”，没有 Notion OAuth、Parent Page 选取、按来源建库与页面覆盖更新流程。
- ID 生成策略偏弱：
  - 存在 `position` 驱动 messageId 的实现，页面重排或懒加载场景下稳定性一般。

### 11.3 对本项目的启发映射

- 可保留的总体框架：
  - `adapter -> extractor -> storage manager -> background db`。
- 需要替换/增强的关键点：
  - 会话键与消息键：按本项目已确认策略（messageId 优先，hash 回退）。
  - NotionAI 三形态：必须以“聊天根容器”严格约束采集作用域。
  - Notion 同步链路：新增 OAuth、Parent Page、两来源数据库 ensure、页面覆盖更新。
- 可继续参考的代码入口：
  - `Resource/demo/js/core/base.js`
  - `Resource/demo/js/core/storage-manager.js`
  - `Resource/demo/js/background.js`
  - `Resource/demo/js/adapters/chatgpt.js`

## 12. P3 平台接入顺序建议（草案）

- 批次 A（优先）：`Claude`、`Gemini`
- 批次 B：`DeepSeek`、`Kimi`
- 批次 C：`Doubao`、`Yuanbao`

说明：
- 每接入一个平台，先通过 P1 验收口径（采集/入库/导出）再进入 Notion 同步验收。
- 未达标平台不进入默认启用列表。
- 在批次 B 完成后并行验证 article fetch 骨架，确保 sourceType 扩展链路可用。
