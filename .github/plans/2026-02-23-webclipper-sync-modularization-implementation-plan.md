# WebClipper Sync 模块化重构实施计划

> 执行方式：建议使用`executing-plans` 按批次实现与验收。

**Goal（目标）:** 在不改变现有功能与用户可见行为的前提下，重构 `Extensions/WebClipper` 中 Obsidian 与 Notion 同步链路，落实 SOLID/DRY，降低耦合并提升可测试性。  

**Non-goals（非目标）:** 不新增同步目标；不改动国际化文本；不调整 UI 视觉；不改动 IndexedDB schema 版本号。  

**Approach（方案）:** 先在 Popup 层提取重复逻辑（剪贴板、会话文档构造、同步结果映射），再把 Background 的路由与业务执行分离（Obsidian 服务、Notion Job Store、Notion Orchestrator），最后拆分 `notion-sync-service` 的超大职责（Markdown 解析、页面属性构建、图片上传升级）。每个阶段均以现有 smoke tests 为回归基线，并补齐新增模块测试。  

**Acceptance（验收）:**
- `npm --prefix Extensions/WebClipper run test` 全量通过。
- Obsidian 链路：选中单条/多条会话都能成功触发 `obsidian://new`（含剪贴板成功和失败降级路径）。
- Notion 链路：首次创建、增量追加、cursor 丢失重建、同步失败提示、popup 重开后的 job 恢复均可工作。
- `background-router.js` 不再内嵌完整 Notion 同步编排逻辑；`popup.js` 不再重复维护同步结果映射逻辑。

---

## P1（最高优先级）：Popup 层去重与职责拆分

### Task 1: 提取 runtime 消息类型与结果结构契约

**Files:**
- Create: `Extensions/WebClipper/src/shared/message-contracts.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup-notion.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background-router.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.html`

**Step 1: 实现功能**
把 `openObsidianUrl`、`notionSyncConversations`、`getNotionSyncJobStatus` 等消息 type 常量集中到共享契约模块，popup/background 全部改为引用同一份定义，避免字符串散落。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/background-router-obsidian-open.test.ts tests/smoke/background-router-notion-sync.test.ts`  
Expected: 全部 PASS，消息分发行为不变。

**Step 3:（可选）原子提交**
Run: `git commit -m "refactor: task1 - centralize webclipper runtime message contracts"`

### Task 2: 提取剪贴板能力，消除重复实现

**Files:**
- Create: `Extensions/WebClipper/src/ui/popup/popup-clipboard.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup-list.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup-core.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.html`

**Step 1: 实现功能**
将 `copyTextToClipboard` 的两套实现合并为一个共享模块，统一 fallback（`navigator.clipboard` -> `execCommand`）与错误处理，`popup.js`/`popup-list.js` 改为复用。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test`  
Expected: 全量测试通过；无脚本加载顺序错误。

**Step 3: 手工验证**
在扩展 popup 中：  
1. 选中会话点击列表“复制 Markdown”按钮。  
2. 点击 `Obsidian` 按钮触发复制+打开。  
Expected: 两处复制成功反馈一致，失败时错误提示一致。

**Step 4:（可选）原子提交**
Run: `git commit -m "refactor: task2 - extract shared popup clipboard utility"`

### Task 3: 提取会话文档构造器，统一导出与 Obsidian 数据准备

**Files:**
- Create: `Extensions/WebClipper/src/ui/popup/popup-conversation-docs.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup-export.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.html`
- Test: `Extensions/WebClipper/tests/smoke/popup-conversation-docs.test.ts`

**Step 1: 实现功能**
抽象“已选会话 -> 读取 detail -> 生成 markdown docs”流程，输出统一结构供 `exportJson/exportMd` 与 `buildObsidianPayload` 复用，去除重复循环与重复错误处理。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/popup-conversation-docs.test.ts`  
Expected: 新增测试 PASS（覆盖空选择、会话缺失、detail 拉取失败、多会话聚合）。

**Step 3: 回归验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/zip-utils.test.ts tests/smoke/background-router-obsidian-open.test.ts`  
Expected: 导出与 Obsidian 主流程相关测试仍 PASS。

**Step 4:（可选）原子提交**
Run: `git commit -m "refactor: task3 - share popup conversation docs builder"`

### Task 4: 提取 Notion 同步结果映射器，统一 UI 状态更新

**Files:**
- Create: `Extensions/WebClipper/src/ui/popup/popup-notion-sync-state.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup-list.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.html`
- Test: `Extensions/WebClipper/tests/smoke/popup-notion-sync-state.test.ts`

**Step 1: 实现功能**
把 `state.notionSyncById` 的写入逻辑（mode/ok/appended/error/at）集中到一个 helper，`applyPerConversationResults` 与点击 Sync 后本地结果处理共用，去掉重复代码。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/popup-notion-sync-state.test.ts tests/smoke/background-router-notion-sync.test.ts`  
Expected: PASS，popup badge 显示逻辑不回归。

**Step 3:（可选）原子提交**
Run: `git commit -m "refactor: task4 - unify popup notion sync result mapping"`

## P2：Background 路由与同步编排解耦

### Task 5: 提取 Obsidian 后台服务，router 仅做分发

**Files:**
- Create: `Extensions/WebClipper/src/sync/obsidian/obsidian-url-service.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background-router.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`
- Test: `Extensions/WebClipper/tests/smoke/background-router-obsidian-open.test.ts`

**Step 1: 实现功能**
把 `isObsidianUrl/openObsidianUrl` 从 router 内部移到独立服务，router 只校验 message 并调用服务接口。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/background-router-obsidian-open.test.ts`  
Expected: PASS，`tabs.update -> tabs.create` 降级行为保持一致。

**Step 3:（可选）原子提交**
Run: `git commit -m "refactor: task5 - extract obsidian background url service"`

### Task 6: 提取 Notion Sync Job 存储与状态机

**Files:**
- Create: `Extensions/WebClipper/src/sync/notion/notion-sync-job-store.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background-router.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`
- Test: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

**Step 1: 实现功能**
抽离 `get/set/abort/isRunning` 相关 job 操作，统一处理 stale guard 与 instanceId abort，router 不再直接操作 `chrome.storage.local` 中的 job 细节。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/background-router-notion-sync.test.ts`  
Expected: PASS，`getNotionSyncJobStatus` 与 in-progress 拦截行为不变。

**Step 3:（可选）原子提交**
Run: `git commit -m "refactor: task6 - extract notion sync job store"`

### Task 7: 提取 Notion 同步编排器（Orchestrator）

**Files:**
- Create: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background-router.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`
- Test: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`
- Test（如需）: `Extensions/WebClipper/tests/smoke/notion-sync-orchestrator.test.ts`

**Step 1: 实现功能**
将 `notionSyncConversations` 的主流程（token/parent/db 校验、cursor 决策、create/append/rebuild、perConversation 汇总）迁移到 orchestrator，router 仅负责消息入口、参数校验与响应包装。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/background-router-notion-sync.test.ts`  
Expected: PASS，`created/appended/rebuilt/no_changes` 结果模式不变。

**Step 3:（可选）补测试**
为 orchestrator 直接补单元测试，覆盖：
- 空消息列表
- cursor 丢失重建
- page 已删重建
- 局部失败不影响其它会话

Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/notion-sync-orchestrator.test.ts`  
Expected: PASS

**Step 4:（可选）原子提交**
Run: `git commit -m "refactor: task7 - split notion sync orchestration from router"`

## P3：Notion 同步服务内部解耦与 DRY

### Task 8: 拆分 Markdown -> Notion Blocks 转换模块

**Files:**
- Create: `Extensions/WebClipper/src/sync/notion/notion-markdown-blocks.js`
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`
- Test: `Extensions/WebClipper/tests/smoke/notion-sync-service-markdown.test.ts`

**Step 1: 实现功能**
把 `inlineMarkdownToRichText/markdownToNotionBlocks` 及其内部 helper 迁移到独立模块，`notion-sync-service` 仅调用转换 API，减少单文件体积和职责。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/notion-sync-service-markdown.test.ts`  
Expected: PASS，标题/列表/引用/代码块/公式/图片转换结果一致。

**Step 3:（可选）原子提交**
Run: `git commit -m "refactor: task8 - split notion markdown block converter"`

### Task 9: 统一页面属性构建逻辑（Create/Update DRY）

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.js`
- Test: `Extensions/WebClipper/tests/smoke/notion-sync-service.test.ts`

**Step 1: 实现功能**
合并 `buildPagePropertiesForCreate` 与 `buildPagePropertiesForUpdate` 为参数化构建函数（例如 `includeDate`），统一 `Name/URL/AI` 逻辑，避免属性变更时双改。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/notion-sync-service.test.ts`  
Expected: PASS，create/update 的请求 payload 保持兼容。

**Step 3:（可选）原子提交**
Run: `git commit -m "refactor: task9 - deduplicate notion page property builders"`

### Task 10: 拆分图片上传升级逻辑，收敛重复工具函数

**Files:**
- Create: `Extensions/WebClipper/src/sync/notion/notion-image-upload-upgrader.js`
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.js`
- Modify: `Extensions/WebClipper/src/sync/notion/notion-files-api.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`
- Test: `Extensions/WebClipper/tests/smoke/notion-sync-service-image-upload.test.ts`

**Step 1: 实现功能**
将 `upgradeImageBlocksToFileUploads` 与其下载/猜测文件名/日志清洗逻辑抽出，尽量复用 `notion-files-api` 现有能力，减少 `notion-sync-service` 的 I/O 细节耦合。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/notion-sync-service-image-upload.test.ts tests/smoke/notion-files-api.test.ts`  
Expected: PASS，external_url 成功、byte fallback、失败保留 external URL 三条路径均保持不变。

**Step 3:（可选）原子提交**
Run: `git commit -m "refactor: task10 - extract notion image upload upgrader"`

## P4：回归与交付

### Task 11: 全量回归验证（自动化 + 最小手工）

**Files:**
- Modify（如需）: `Extensions/WebClipper/tests/smoke/*.test.ts`
- Modify（如需）: `Extensions/WebClipper/tests/storage/*.test.ts`

**Step 1: 自动化验证**
Run: `npm --prefix Extensions/WebClipper run test`  
Expected: 全量 PASS。

**Step 2: 手工冒烟**
1. 打开扩展 popup，选中会话点击 `Obsidian`，确认可打开 Obsidian。  
2. 点击 `Sync` 到 Notion，验证首同步与重复同步（无变化）提示。  
3. 关闭并重开 popup，确认同步状态徽章仍可恢复显示。  
Expected: 与重构前行为一致。

**Step 3:（可选）最终提交**
Run: `git commit -m "refactor: task11 - complete webclipper sync modularization regression"`

---

## 边界条件清单

- 空选择：`Obsidian` 与 `Sync` 按钮必须保持禁用或直接返回，不触发请求。
- 剪贴板失败：Obsidian 必须回退到 `content` 参数模式，不应直接失败。
- cursor 缺失：Notion 同步必须进入 `rebuilt` 分支且可恢复后续增量。
- 页面失效：Notion page 被删除/归档时应自动 `created` 新页并更新 mapping。
- 批量部分失败：单会话失败不能阻断剩余会话同步，`perConversation` 需保留完整结果。

## 回归策略

- 每完成一个优先级分组（P1/P2/P3）后执行一次：
`npm --prefix Extensions/WebClipper run test -- tests/smoke/background-router-notion-sync.test.ts tests/smoke/background-router-obsidian-open.test.ts`
- 完成 P4 后执行完整测试：
`npm --prefix Extensions/WebClipper run test`

## 不确定项（执行前确认）

- 是否要求本次重构保留所有 `alert` 文案完全不变（包括标点和换行）。
- 是否允许在不改功能前提下新增少量“内部模块文件”（仅重构用途）。
- 是否需要按 Task 粒度强制提交（若需要，按文档中的 Conventional Commits 执行）。
