# WebClipper Obsidian Local REST API 全量重构实施计划

> 执行方式：建议使用`executing-plans`按批次实现与验收。

**Goal（目标）:** 将 WebClipper 的 Obsidian 能力从“URI 导出”重构为“基于 Local REST API 的平台主导同步”，实现 `远端存在=增量`、`远端不存在=全量重建`，并支持可观测的同步状态。

**Non-goals（非目标）:**
- 不改动 Notion 同步逻辑与数据模型。
- 不改动采集器（collectors）抓取逻辑。
- 不做多设备分布式一致性（只保证单机 Obsidian Local REST API 场景）。
- 不改动国际化字段与多语言文案体系。

**Approach（方案）:**
- 以 `obsidian-local-rest-api` 为唯一同步通道，后台发起 HTTP(S) 请求；popup 只负责配置、触发和展示结果。
- 同步状态以 Obsidian 文件 frontmatter 为主（`syncnos` 对象存游标与版本）；扩展仅保存连接配置（Base URL、API Key、开关），不保存“已同步到哪条消息”的游标。
- 为避免“标题改名导致找不到旧文件”，使用 `conversationKey` 生成稳定文件路径；标题仅作为 frontmatter 显示字段。
- 每次同步先 `GET /vault/<path>` 检查远端：`404 -> PUT 全量`，`200 -> 读取 note+json 决策增量`。
- 增量写入优先使用 `PATCH /vault/<path>`（按 heading 追加）以获得去重能力；写入游标使用 `PATCH frontmatter`，两步均可重试且幂等。
- 若检测到历史消息被改写/删除、frontmatter 缺失或不兼容，自动回退 `PUT` 全量重建，保证可恢复性。
- 本期仅支持插件 `HTTP (Insecure Mode, :27123)`（`http://127.0.0.1:27123`）。`https://127.0.0.1:27124` 自签名证书信任与 HTTPS 支持暂不纳入范围（避免引入证书安装/信任流程与跨浏览器差异）。

**Acceptance（验收）:**
- 选中会话后执行 Obsidian 同步，首次写入成功创建文件；再次同步仅追加新增消息。
- 在 Obsidian 手动删除对应文件后，再次同步可自动全量重建文件。
- 在 Obsidian 保留文件但移除同步 frontmatter 后，再次同步可自动回退全量写入并补齐 frontmatter。
- API Key 鉴权失败、服务不可达等都能在 UI 给出明确错误（本期不实现 HTTPS 证书错误的专门引导）。
- 重复触发同一批增量不会重复写入（去重生效）。
- 自动化验证通过：`npm --prefix Extensions/WebClipper run test` 与 `npm --prefix Extensions/WebClipper run check`。

---

## P1（最高优先级）：重构协议与基础设施

### Task 1: 重构消息协议，新增 Obsidian 同步指令（移除 URI 模式）

**Files:**
- Modify: `Extensions/WebClipper/src/protocols/message-contracts.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background-router.js`
- Create: `Extensions/WebClipper/tests/smoke/background-router-obsidian-sync.test.ts`

**Step 1: 实现功能**
- 新增 Obsidian 消息类型：`SYNC_CONVERSATIONS`、`GET_SYNC_STATUS`、`TEST_CONNECTION`、`SAVE_SETTINGS`、`GET_SETTINGS`。
- 删除 `OPEN_URL` 路由与相关 UI 逻辑（不再支持 `obsidian://` URI 导出）。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/background-router-obsidian-sync.test.ts`  
Expected: Obsidian 同步路由测试通过。

**Step 3:（可选）原子提交**
Run: `git commit -m "refactor: task1 - add obsidian sync message contracts"`

### Task 2: 新增 Obsidian 连接配置存储与读取服务

**Files:**
- Create: `Extensions/WebClipper/src/export/obsidian/obsidian-settings-store.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background-router.js`
- Test: `Extensions/WebClipper/tests/smoke/background-router-obsidian-sync.test.ts`

**Step 1: 实现功能**
- 统一存储键：`obsidian_sync_enabled`、`obsidian_api_base_url`、`obsidian_api_key`、`obsidian_api_auth_header_name`。
- 所有写入由 background 执行，popup 不直接触达密钥。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/background-router-obsidian-sync.test.ts`  
Expected: 可读写配置、字段缺失时使用默认值。

**Step 3:（可选）原子提交**
Run: `git commit -m "feat: task2 - add obsidian settings store for local rest api"`

### Task 3: 实现 Local REST API Client（鉴权、错误归一化、证书策略）

**Files:**
- Create: `Extensions/WebClipper/src/export/obsidian/obsidian-local-rest-client.js`
- Test: `Extensions/WebClipper/tests/smoke/obsidian-local-rest-client.test.ts`

**Step 1: 实现功能**
- 封装 `GET/PUT/POST/PATCH /vault/<path>` 与 `GET /`（无需鉴权但返回 `authenticated`）健康检查。
- 路径编码：对每个 path segment 做 `encodeURIComponent`，保留 `/` 为真实分隔符（不要把 `/` 编码成 `%2F`）。
- 统一注入 `Authorization: Bearer <apiKey>`（header 名默认 `Authorization`，但允许用户在插件端改名时可配置）。
- 支持 `Accept: application/vnd.olrapi.note+json`（读取 frontmatter/tags/stat/content）与 `text/markdown`（纯文本）。
- 统一错误结构：`network_error`、`auth_error`、`not_found`、`bad_request`。
- 若用户配置了 `https://` Base URL：直接返回清晰错误（本期不支持），提示改用 `http://127.0.0.1:27123`。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/obsidian-local-rest-client.test.ts`  
Expected: 认证头、路径编码、错误分类符合预期。

**Step 3:（可选）原子提交**
Run: `git commit -m "feat: task3 - add obsidian local rest api client"`

### Task 4: 建立稳定文件路径与同步元数据编解码

**Files:**
- Create: `Extensions/WebClipper/src/export/obsidian/obsidian-note-path.js`
- Create: `Extensions/WebClipper/src/export/obsidian/obsidian-sync-metadata.js`
- Test: `Extensions/WebClipper/tests/smoke/obsidian-note-path.test.ts`
- Test: `Extensions/WebClipper/tests/smoke/obsidian-sync-metadata.test.ts`

**Step 1: 实现功能**
- 基于 `source + conversationKey` 生成稳定 `filePath`（不依赖标题），建议使用短 hash（避免文件名超长/非法字符）。
- 约定 frontmatter 结构（作为平台主导的单一事实来源）：
  - `syncnos.conversationKey`
  - `syncnos.source`
  - `syncnos.schemaVersion`
  - `syncnos.lastSyncedSequence`
  - `syncnos.lastSyncedMessageKey`

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/obsidian-note-path.test.ts`  
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/obsidian-sync-metadata.test.ts`  
Expected: 相同会话始终命中同一路径；frontmatter 解析/回写稳定。

**Step 3:（可选）原子提交**
Run: `git commit -m "feat: task4 - add deterministic note path and sync metadata codec"`

### P1 回归验证
Run: `npm --prefix Extensions/WebClipper run test`  
Run: `npm --prefix Extensions/WebClipper run check`  
Expected: 无回归失败，静态检查通过。

---

## P2：实现 Obsidian 同步编排（平台主导）

### Task 5: 新建 Obsidian 同步编排器

**Files:**
- Create: `Extensions/WebClipper/src/export/obsidian/obsidian-sync-orchestrator.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background-router.js`
- Test: `Extensions/WebClipper/tests/smoke/obsidian-sync-orchestrator.test.ts`

**Step 1: 实现功能**
- 入口：`syncConversations({ conversationIds, instanceId })`。
- 编排职责：读取会话与消息、探测远端、选择增量/全量、写入、汇总结果。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/obsidian-sync-orchestrator.test.ts`  
Expected: 编排器返回每条会话的 `mode`、`ok`、`error`。

**Step 3:（可选）原子提交**
Run: `git commit -m "feat: task5 - add obsidian sync orchestrator"`

### Task 6: 实现“远端存在性驱动”的同步决策

**Files:**
- Modify: `Extensions/WebClipper/src/export/obsidian/obsidian-sync-orchestrator.js`
- Test: `Extensions/WebClipper/tests/smoke/obsidian-sync-orchestrator.test.ts`

**Step 1: 实现功能**
- `GET /vault/<path>` 返回 `404` 时执行 `PUT` 全量构建。
- 返回 `200` 时使用 `Accept: application/vnd.olrapi.note+json` 读取 frontmatter 与 content，计算增量区间。
- frontmatter 缺失或 schema 不兼容时执行 `PUT` 全量重建。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/obsidian-sync-orchestrator.test.ts`  
Expected: `404 -> full_rebuild`，`200 + cursor -> incremental_append`。

**Step 3:（可选）原子提交**
Run: `git commit -m "feat: task6 - implement remote-existence based sync mode decision"`

### Task 7: 实现增量追加与全量重建写入器

**Files:**
- Create: `Extensions/WebClipper/src/export/obsidian/obsidian-markdown-writer.js`
- Modify: `Extensions/WebClipper/src/export/obsidian/obsidian-sync-orchestrator.js`
- Test: `Extensions/WebClipper/tests/smoke/obsidian-markdown-writer.test.ts`

**Step 1: 实现功能**
- 全量：生成完整 markdown（frontmatter + 全消息 + 稳定 SyncNos section）并 `PUT /vault/<path>`。
- 增量：
  - 使用 `PATCH /vault/<path>`，headers:
    - `Operation: append`
    - `Target-Type: heading`
    - `Target: SyncNos::Messages`（固定 heading 链；必要时 URL-encode）
    - `Create-Target-If-Missing: true`
    - 不设置 `Apply-If-Content-Preexists`（默认去重；若服务返回 `content-already-preexists-in-target` 视为幂等成功）
  - request body 为“仅新增消息片段”（`Content-Type: text/markdown`）。
- 游标更新：使用 `PATCH frontmatter` 将 `syncnos` 对象整体 `replace`（`Content-Type: application/json` + `Create-Target-If-Missing: true`）。
- 写入顺序：先增量追加，后更新 frontmatter；若追加因 `content-already-preexists-in-target` 被拒绝，仍需尝试更新 frontmatter 以修复游标。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/obsidian-markdown-writer.test.ts`  
Expected: 写入 payload 中包含正确游标和消息内容。

**Step 3:（可选）原子提交**
Run: `git commit -m "feat: task7 - add markdown writers for full rebuild and incremental append"`

### Task 8: 实现冲突检测与自动回退

**Files:**
- Modify: `Extensions/WebClipper/src/export/obsidian/obsidian-sync-orchestrator.js`
- Test: `Extensions/WebClipper/tests/smoke/obsidian-sync-orchestrator.test.ts`

**Step 1: 实现功能**
- 若检测到 `lastSyncedSequence` 之前消息已变化（messageKey 不匹配或 updatedAt 回退），自动切换 `full_rebuild`。
- 若 `PATCH` 返回 `40080 PatchFailed` 且原因不是 `content-already-preexists-in-target`，自动重试 `PUT`。
- 若 `PATCH`/`PUT` 失败且错误看似来自证书校验，提示用户切换到 insecure HTTP 或信任证书。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/obsidian-sync-orchestrator.test.ts`  
Expected: 冲突场景最终成功并标记 `mode=full_rebuild_fallback`。

**Step 3:（可选）原子提交**
Run: `git commit -m "feat: task8 - add conflict detection and full-rebuild fallback"`

### P2 回归验证
Run: `npm --prefix Extensions/WebClipper run test`  
Run: `npm --prefix Extensions/WebClipper run check`  
Expected: 新增编排逻辑测试稳定通过。

---

## P3：重构 Popup 交互与状态展示

### Task 9: 将“Add to Obsidian”重构为“Sync Obsidian”动作

**Files:**
- Modify: `Extensions/WebClipper/src/ui/popup/popup.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup-list.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup-core.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.html`
- Modify: `Extensions/WebClipper/src/ui/styles/popup.css`

**Step 1: 实现功能**
- Obsidian 按钮改为触发后台同步任务而非直接打开 URI。
- 增加进行中状态与结果提示（成功数、失败数、失败原因摘要）。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test`  
Expected: 单测无回归；按钮状态切换正确（无选中项时禁用、进行中时禁用、结束后恢复）。

**Step 3:（可选）原子提交**
Run: `git commit -m "refactor: task9 - switch popup obsidian action to sync workflow"`

### Task 10: 新增 Obsidian 连接设置与连通性测试

**Files:**
- Create: `Extensions/WebClipper/src/ui/popup/popup-obsidian-sync.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.html`
- Modify: `Extensions/WebClipper/src/ui/styles/popup.css`
- Test: `Extensions/WebClipper/tests/smoke/popup-obsidian-sync.test.ts`

**Step 1: 实现功能**
- 设置项：API Base URL、API Key、启用开关、连接测试按钮。
- Base URL 默认：`http://127.0.0.1:27123`（插件 HTTP Insecure Mode）。
- 密钥输入框仅显示掩码；保存时走 background 消息。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/popup-obsidian-sync.test.ts`  
Expected: 设置读写成功，测试连接结果可反馈。

**Step 3:（可选）原子提交**
Run: `git commit -m "feat: task10 - add popup settings for obsidian local rest api"`

### Task 11: 同步结果可观测性与手动恢复入口

**Files:**
- Modify: `Extensions/WebClipper/src/ui/popup/popup-list.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background-router.js`
- Modify: `Extensions/WebClipper/src/export/obsidian/obsidian-sync-orchestrator.js`
- Test: `Extensions/WebClipper/tests/smoke/popup-obsidian-sync-state.test.ts`

**Step 1: 实现功能**
- 每条会话展示 `full_rebuild` / `incremental_append` / `no_changes` / `failed`。
- 提供“强制全量同步本条”入口（仅影响本次任务，不改全局策略）。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/popup-obsidian-sync-state.test.ts`  
Expected: 状态 pill 与 tooltip 准确。

**Step 3:（可选）原子提交**
Run: `git commit -m "feat: task11 - add sync status visibility and force-full action"`

### P3 回归验证
Run: `npm --prefix Extensions/WebClipper run test`  
Run: `npm --prefix Extensions/WebClipper run check`  
Expected: UI 与交互相关 smoke 测试全部通过。

---

## P4：兼容迁移、文档与最终验收

### Task 12: 文档与开发说明更新

**Files:**
- Modify: `Extensions/WebClipper/AGENTS.md`
- Create: `.github/docs/webclipper-obsidian-local-rest-api-sync.md`

**Step 1: 实现功能**
- 补充本地 API 配置步骤、安全建议、故障排查（本期仅覆盖 HTTP :27123）。
- 安全建议至少覆盖：绑定 `127.0.0.1`（避免 `0.0.0.0` 暴露到局域网）、谨慎启用 HTTP insecure、API Key 视为敏感信息与轮换方式。
- 明确“远端存在驱动”策略与 frontmatter 字段约定。

**Step 2: 验证**
Run: `rg -n "Obsidian|Local REST API|frontmatter|full_rebuild|incremental" Extensions/WebClipper/AGENTS.md .github/docs/webclipper-obsidian-local-rest-api-sync.md`  
Expected: 文档术语一致，路径准确。

**Step 3:（可选）原子提交**
Run: `git commit -m "docs: task12 - document obsidian local rest api sync architecture"`

### Task 13: 端到端冒烟与打包校验

**Files:**
- Modify: `Extensions/WebClipper/tests/smoke/`（按需要补充 e2e smoke）

**Step 1: 实现功能**
- 补充端到端 smoke：首次全量、二次增量、远端删除后重建、认证失败。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test`  
Run: `npm --prefix Extensions/WebClipper run check`  
Run: `npm --prefix Extensions/WebClipper run build`  
Expected: 测试、检查、构建全部通过。

**Step 3:（可选）原子提交**
Run: `git commit -m "test: task13 - add obsidian local rest api end-to-end smoke coverage"`

---

## 边界条件与回归策略

- 空会话（0 条消息）: 同步应拒绝并提示原因，不创建空白垃圾文件。
- 重复消息 key: 增量计算必须去重，避免重复 append。
- 历史消息编辑: 自动回退全量重建，防止远端内容分叉。
- API 不可用: 不应卡死任务，单条失败可继续其它条目；需给出可执行的修复路径（例如确认插件启用、Base URL 正确、API Key 正确）。
- PATCH 去重反馈: `40080 PatchFailed` 且 message 为 `content-already-preexists-in-target` 时应视为幂等成功（不算失败）。
- 用户手动改标题: 不影响文件定位（路径由 conversationKey 决定）。

每完成一个优先级分组后统一执行：
- `npm --prefix Extensions/WebClipper run test`
- `npm --prefix Extensions/WebClipper run check`

---

## 不确定项（执行前确认）

- 已确认：直接移除 URI 模式。
- 已确认：本期仅支持 HTTP（27123）。
- 待最终确认：frontmatter 字段命名采用 `syncnos` 命名空间对象（推荐），还是改为扁平键（例如 `syncnos_*`）。
