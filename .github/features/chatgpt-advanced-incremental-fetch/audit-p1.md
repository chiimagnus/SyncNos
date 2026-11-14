# P1｜阶段审查

审查对象：[P1 实施计划](plan-p1.md)。
实时任务状态以 `todo.toml` 为准。

## 结论

- **结果：Go（Helium / Chromium MV3 的 ChatGPT Advanced 核心流程）；No-Go（全浏览器、旧版本显式切回等未测条件）**。
- **依据**：2026-11-14 在用户明确授权弃用的现有 ChatGPT 会话，实际操作首次采集、重复 Fetch、追加、重新生成、编辑提问、失败后恢复，核对真实 IndexedDB、App、Markdown/JSON ZIP 和 PNG 附件，全部达到对应验收要求。无法从当前 ChatGPT 版本对话框显式激活旧回复分支，且 Zen/Safari 尚无相同的实机验收；见 F-01。

## 任务与改动

- **P1-T1**（`a8eb03ed9`）：`tests/unit/chatgpt-api-capture.test.ts` 修正 `metadata.parent_id` 夹具并新增跨分页分支测试；真实 ChatGPT API 只读取结构，确认 `num_turns` 不等于原始节点数，工具密集响应中父链可能在到达用户回合前断开。
- **P1-T2**（`0d2b311d7`）：`api-capture.ts`、`current-page-capture.ts`、`storage-idb.ts`、Background 路由、`models.ts`、Backup import/export 建立原子可信前缀、Thinking 设置快照和轻量尾窗；旧版、DOM 或未确认完整的历史不会伪造可信基准。
- **P1-T3**（`64fcedf9d`）：`api-capture.ts` 从新到旧提前停页并识别当前分支；`current-page-capture.ts` 与 `storage-idb.ts` 有界尾部替换、消息修订号冲突拒绝/一次全量恢复；图片回填使用精确消息键且兼顾旧持久队列恢复。新增 `tests/integration/chatgpt-api-incremental-fetch.test.ts`。同步维护根 `AGENTS.md` 与三份 canonical 文档，清理旧 `live-tail` 测试术语。

## 发现项

## 发现 F-01

- 任务：`P1-T3`
- 严重级别：`High`
- 状态：`Open`
- 位置：`docs/ai-chat-testing.md:285`
- 摘要：`Helium 已实测编辑与重新生成，尚缺同一会话旧回复分支的显式切回及其它浏览器实机覆盖`
- 风险：`真实编辑提问和重新生成已经证明旧分支消息可正确清除，但不能据此证明所有站点版本切换操作与所有浏览器实现都一致。`
- 预期修复：`当站点允许选中旧回复分支时，在授权测试会话执行当前→旧版→当前的切换并核对 IndexedDB/导出；同时在 Zen、Safari 和实际受支持的其它环境按 API-01 验证。`
- 验证：`docs/ai-chat-testing.md API-01；重点比较 selected current_node、完整消息 key、历史前缀、旧分支清理、修订号与导出。`
- 已取得的部分证据：`Helium 真机编辑提问、重新生成、Markdown/JSON ZIP 与 PNG 附件读回均通过；“查看版本”界面目前仅能预览版本或在新聊天创建分支，未执行旧分支重新激活。F-01 保留 Open。`


## 验证与未覆盖

### 已通过的自动化与构建

- macOS 27.3 / Apple Silicon；Node.js **22.22.2**：`npm run gate` exit 0，**372 个测试文件 / 3283 项测试全过**，ESLint、Prettier、TypeScript、Chromium 正式构建及包体预算检查全部通过。记录：`/tmp/syncnos-t3-v3-gate.log`。
- 同一主机 Node.js **25.9.0**：`npm run gate` exit 0，372/3283 全过，正式构建和包体检查通过。记录：`/tmp/syncnos-t3-node25-gate.log`。
- Node.js 22：`npm run build:firefox`、`npm run check:zen`（含 XPI 打包）、`npm run check:safari`、`npm run cli:check` **退出码均为 0**；对应记录 `/tmp/syncnos-t3-v3-{firefox,zen,safari,cli}.log`。
- `tests/integration/chatgpt-api-incremental-fetch.test.ts`：真实采集业务函数 + Background 路由 + `fake-indexeddb`，覆盖首次完整、续聊、无变化、编辑最后用户提问、重新生成、生成中安全暂存/完成后清理、缺失父关系的助手重叠和跨标签页消息修订竞争，核对最终本地消息键、正文、顺序、修订号与通知。
- **10,000 条真实 IndexedDB 消息** + 一轮新增：正常增量只请求 10-turn 最新页和两次 HEAD，不调用整段消息索引 `getAll`；验证旧前缀仍可随机读回。另以匿名分页夹具覆盖 1000 页/10000 个用户节点，找交界后立即停页。
- 图片调度：新增回填按消息键读取；旧持久队列未被新轻量任务覆盖，Service Worker 重启后仍可完整回退。针对这两个边界均有先失败再通过的回归。
- 使用已登录 Helium **只读** ChatGPT API：观察到 1538 个原始节点、73 个可见交互节点、最新 `current_node` 父链仅连通 4 节点、未连通到用户消息；据此补充无已知 sibling 时的有序助手重叠交界。未发送模型请求、未修改会话，也没有记录私人正文/Token。

### 已完成的 Helium 真实浏览器 E2E（2026-11-14）

测试对象：用户明确允许修改的既有废弃 ChatGPT 会话（私人会话链接不写入 Git）。Helium 已安装本地 unpacked SyncNos，扩展的 `background.js` SHA-256 与实际构建文件相同。**必须额外重新加载 Service Worker 和目标网页**：初次发现 Worker 启动于 13:50，而本次构建产物生成于 14:04；旧 Worker 缺少新 `messagesRevision` 字段，使“无变化重复 Fetch”误读 2 页旧历史，耗时 26 秒，但未破坏数据。只重载 SyncNos 扩展后，Worker 于 14:32 重新启动，紧接着轻量尾窗返回了正确修订号，再测通过。这是验证环境的代码版本失配，不是当前构建的增量算法缺陷。

- **首次**：真实 Content → MAIN world API → Background → IndexedDB：原先未保存的会话完整写入 22 条（11 user / 11 assistant），建立可信最后用户校验点，无 warning，耗时约 19 秒。
- **无变化**：Worker 重载后耗时约 12 秒；旧页请求 0，22 条消息哈希、`lastActivityAt`、消息与会话修订号均不变。随后多次重复 Fetch，全部保持幂等。
- **追加**：通过 ChatGPT UI 发送 `SYNCNOS-A-20261114` 测试提问并获得完成的回复。增量 Fetch 只访问 `num_turns=10,1,1`，旧页请求 0；22 → 24 条，原 22 条 SHA-256 不变，校验点推进到新用户，消息角色和顺序正确。
- **重新生成**：通过 ChatGPT UI 的“更多操作 → 重新生成回复”完成真实再生成。旧 assistant key 从 IndexedDB 消失，新 assistant key 存在；总数仍为 24，原 22 条不变，旧页请求 0。
- **编辑提问**：在 UI 编辑最后用户消息，把测试标记从 A 改为 B；ChatGPT API 返回新的 user/assistant ID，旧节点已不在当前分支。Fetch 自动回退读取 2 页旧历史，成功清理旧提问和旧回答、保存新的 2 条消息；总数 24、旧前缀未动、校验点更新，无 warning。再次重复 Fetch：旧页请求 0，消息哈希、活动时间和两个修订号均不变。
- **真实 App/导出**：通过已安装的 SyncNos App 展示 B 分支，并使用 App 实际 UI **只选中这一条会话**导出 Markdown ZIP 和 JSON ZIP；均通过完整解压测试。JSON schema v2：24 条（12 user / 12 assistant）、1 个附件、B 存在而 A 不存在；ZIP 内 PNG 可解码（2048×1475 RGBA）。`getConversationDetail` 后台 API 的读回内容也与 IndexedDB 一致。
- **完整 UI 路由**：从 SyncNos App 执行真正的 `captureActiveTabCurrentPage` 后台入口；成功且旧页请求 0，内容哈希、两个修订号及活动时间不变。
- **导航中断与恢复**：在 Fetch 起始立即离开测试会话，操作返回“当前页面无法捕获”；旧 24 条内容哈希、两个修订号、校验点和活动时间未变。导航回原会话后可重试；完全加载后再次 Fetch 成功，旧页请求 0。重新导航时曾有一条站点自己发出的旧页请求，其发起时间**早于**扩展 Fetch 的最新页请求，不能算作 SyncNos 的分页回退。
- **清理**：已删除本次导出的两个包含私人内容的测试 ZIP，仅关闭本次创建的 App 测试标签页；原有 ChatGPT 标签页与 SyncNos IndexedDB 保存记录保留，仓库生产代码未因测试而修改。

### 尚未完成的实际验收

- **旧回复版本的显式切回**：真实 ChatGPT “查看版本”对话框可预览“版本 1 / 当前版本”，但仅显示“返回当前版本”或“在新聊天中创建分支”，未提供明确的“在原会话中激活旧版本”操作。因此本次实际测试了再生成和编辑导致的两类分支替换，**没有**测试在同一会话里主动切回废弃版本；仍是 F-01 的剩余 No-Go 条件。
- **其它浏览器与独立 Profile**：Helium 的真实安装扩展 E2E 已通过；Zen 已安装，但 `ws://127.0.0.1:9223/session` WebDriver BiDi 当前未连接，本次没有为测试重启或覆盖用户现有 Zen 配置。Safari 未完成原生宿主的安装与操作验收。其它受支持浏览器需要在独立 Profile 逐一复测，正式构建通过不能代替这些实际验收。
- **未提供的其它 OS/浏览器**：macOS 未安装独立 Chrome、Edge、Firefox；Windows 工作站虽有 Edge/Node.js 24，但没有同提交的 SyncNos 测试仓库；Linux CI 及发布 Node.js 24 未在本地实际运行。影响：不能认定这些组合的真实行为已通过；替代证据为 macOS Node22/25 测试与各目标产物构建。补验：在独立已授权环境准备同提交及浏览器，通过同一门禁和真实用户流程；这些受支持环境的完整发布验收仍受限制。
- **真实故障注入**：HTTP 401/403/429/503、网络超时、故障分页、跨页重复 ID、IDB 写入中止和并发变更已由模拟及 `fake-indexeddb` 测试覆盖；没有破坏私人网络状态、修改浏览器登录令牌或主动让实际用户会话失败。影响：真实浏览器恢复仍需实测；补验是在隔离测试 Profile 控制网络并读回已保存数据，不把模拟通过列为实机通过。

文档已对应更新 `AGENTS.md`、`docs/collectors.md`、`docs/storage.md`、`docs/ai-chat-testing.md`；Feature 任务引用与 `todo.toml` 使用现有脚本验证，均在已提交的当前分支 `crth`。
