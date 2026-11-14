# P1｜阶段审查

审查对象：[P1 实施计划](plan-p1.md)。
实时任务状态以 `todo.toml` 为准。

## 结论

- **结果：Go（Helium / Chromium MV3 已覆盖的核心采集与数据保护）；旧版本显式切回仍未验收（F-01 Open）**。
- **依据**：2026-11-14 在用户授权弃用的 ChatGPT 会话中，真实测试首次、重复、续聊、重新生成、较早提问编辑、Thinking 设置往返、两标签并发、导航中断、App/ZIP 读回；失败时保留已存数据。生成中 E 轮完成后遭遇 HTTP 429，尚无最终实机读回。Zen、Safari 按用户要求排除。

## 任务与改动

- **P1-T1**（`a8eb03ed9`）：`tests/unit/chatgpt-api-capture.test.ts` 修正 `metadata.parent_id` 夹具并新增跨分页分支测试；真实 ChatGPT API 只读取结构，确认 `num_turns` 不等于原始节点数，工具密集响应中父链可能在到达用户回合前断开。
- **P1-T2**（`0d2b311d7`）：`api-capture.ts`、`current-page-capture.ts`、`storage-idb.ts`、Background 路由、`models.ts`、Backup import/export 建立原子可信前缀、Thinking 设置快照和轻量尾窗；旧版、DOM 或未确认完整的历史不会伪造可信基准。
- **P1-T3**（`64fcedf9d`，后续修复 `db521fad0`、`bdccfa660`）：完成当前分支有界增量、验证过的尾部替换、并发事务保护、图片按消息键回填。新增生成中完整回合交界回归和长历史有界追加；同步更新数据存储文档。

## 发现项

## 发现 F-03

- 任务：`P1-T3`
- 严重级别：`Medium`
- 状态：`Resolved`
- 位置：`src/services/bootstrap/current-page-capture.ts:511`
- 摘要：`新用户生成中安全追加后，完成 Fetch 选错助手交界导致不必要的完整分页`
- 风险：`保存尾部存在新用户和生成中助手时，选择最后助手作为旧回合重叠；其位置晚于新用户，无法证明旧边界，使正常生成完成再次全历史抓取`
- 预期修复：`在已有可信锚点后定位下一条存储的用户消息，只取这两者之间的最后一条助手消息作为重叠交界；不增加持久状态`
- 验证：`tests/integration/chatgpt-api-incremental-fetch.test.ts 生成中新增用户→完成的红转绿；全量 gate`
- 解决证据：`bdccfa660; streaming u5/a8 finish previously requested nonexistent older page, fixed overlap selection between trusted anchor and next user; integration RED -> GREEN including final IndexedDB keys/content and no older pages; HTTP 401/403/429/503 injected failure preserves state; macOS Node22/25 gate 3284 tests passed.`


## 发现 F-02

- 任务：`P1-T3`
- 严重级别：`Medium`
- 状态：`Resolved`
- 位置：`src/services/conversations/data/storage-idb.ts:1555`
- 摘要：`preserve-existing-tail 追加每次全量读取历史消息，极长会话局部保存退化为 O(history)`
- 风险：`ChatGPT Advanced 的局部追加及其它来源的保护性追加在大历史会话中每次读取全部旧消息，违背增量成本目标并可能造成卡顿和高内存`
- 预期修复：`复用现有 by_conversationId_sequence 索引的反向游标获得最大序号，逐键读取实际改动的消息；保留需要完整重排的 reconcile-existing-order 现行语义`
- 验证：`tests/storage/conversations-idb.test.ts 针对索引读取方式和大历史的红转绿；npm run gate`
- 解决证据：`db521fad0; preserve-tail getAll index RED (1 instead of 0) -> GREEN (0); 10000-message fake-indexeddb verifies one reverse cursor + exact key reads; 257 focused tests passed; Node22 and Node25 gate each 372 files/3284 tests plus Chromium build passed.`


## 发现 F-01

- 任务：`P1-T3`
- 严重级别：`High`
- 状态：`Open`
- 位置：`docs/ai-chat-testing.md:285`
- 摘要：`同一会话显式切回历史回答版本尚未实机验收`
- 风险：`已真实验证重新生成和历史提问编辑可清理旧分支，但不能据此证明在原会话显式恢复废弃版本的语义。`
- 预期修复：`站点提供原会话版本激活入口时，用已授权会话执行当前→旧版→当前，逐步核对 IndexedDB/导出；目前不能人为伪造站点行为。`
- 验证：`docs/ai-chat-testing.md API-01；重点比较 selected current_node、完整消息 key、历史前缀、旧分支清理、修订号与导出。`
- 已取得的部分证据：`Helium 的真实重新生成、最后及较早提问编辑、Markdown/JSON ZIP 与 PNG 读回通过；版本界面只提供预览或在新聊天创建分支。Zen、Safari 按用户要求排除，不作为本 finding 的阻塞。`


## 验证与未覆盖

### 已通过的自动化与构建

- macOS 27.3 / Apple Silicon；Node.js **22.22.2**：最新 `npm run gate` exit 0，372 个测试文件 / **3284 项全过**；ESLint、Prettier、TypeScript、Chromium 正式构建和包体预算均通过。日志 `/tmp/syncnos-final-node22-gate-20261114.log`。
- 同一主机 Node.js **25.9.0**：最新 `npm run gate` exit 0，372/3284 全过，Chromium 构建与包体检查通过。日志 `/tmp/syncnos-final-node25-gate-20261114.log`。
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

### 本轮扩大验证（2026-11-14）

- **Thinking 双向切换**：在 Helium 真实 Fetch，24 条（开启）→ 22 条（关闭）→ 24 条（恢复）。
  恢复后的全部消息 key、顺序、正文与原始哈希一致，原设置已恢复。
- **较早提问编辑**：编辑倒数第二条用户提问并重新生成，真实存储 24→22 条，
  精确删去旧尾部 4 条并写入新尾部 2 条，前 20 条的消息键、顺序、正文及时间戳完全不变。
- **并发**：同标签双 Fetch 只允许一个采集，另一个返回 `manual_capture_in_progress`，
  所有本地修订与内容不变。两个标签并行 Fetch 同一新增回合约 38.6 秒均成功，
  无重复键，校验点指向最新用户；新增的测试标签页已关闭。
- **生成中与限流**：真实后端返回 `in_progress` 时触发 Fetch，结果成功但未增补当时正在生成的 E 轮；
  原 24 条和校验点保留。完成后站点返回 HTTP 429，SyncNos 立即报告限流并停止重试，
  原数据未被误删。为避免继续消耗 API 配额，停止实机 API 请求；完成后 E 轮仍需待限流解除补验，
  本轮不记 PASS。
- **根因修复**：F-02（`db521fad0`）消除局部追加的全历史扫描；F-03（`bdccfa660`）
  修复保存了新用户与流式助手后，完成 Fetch 错选重叠助手导致不必要全量分页。
  均先写失败回归，再修复到通过，未新增状态机。
- **容量与故障矩阵**：`fake-indexeddb` 中 10,000 条旧消息再追加 1 条，不再调用完整序号索引 `getAll`，
  前后序号连续，历史可读取；首次/增量、编辑、再生成、生成中到完成、一次冲突恢复、
  401/403/429/503 与修订保护组合，经真实采集函数 → Background → IndexedDB 的定向测试验证。
  401/403/429 不重试，503 仅重试一次；失败后的消息、校验点、修订号和活动时间不改变。
- **Windows / Node.js 24.14.0**：在工作站 `D:\GitHub\.tmp\syncnos-node24-20261114` 创建临时独立验证树，
  四个受影响的 TypeScript 文件及测试的 SHA-256 与 macOS 当前提交相同。
  `npm ci`、ESLint、Prettier、TypeScript 编译通过；完整采集函数、Background、
  IndexedDB、存储压力的 **4 个测试文件 / 257 项全过**。
  `npm run build`、`npm run check:dist`、`npm run cli:check` 全部 exit 0。
  Windows 全量 `npm run gate` 返回 **exit 1：3163 通过、121 失败，涉及 24 个其它测试文件**，
  包括 CLI 测试的 Unix `/tmp` 硬编码、不同平台绝对路径/分隔符、语言环境和 UI 断言。
  本功能相关四组测试无失败；此结果不能记为 Windows 全仓门禁通过，
  且未授权改动的其它模块未纳入本功能根因修复。
  运行日志已存至 macOS `/tmp/syncnos-node24-{gate-final,focused,build,check-dist,cli-check}-20261114.log`；
  Windows 临时源码、依赖与安装产物共约 351 MB，已全部清理。

### 尚未完成的实际验收

- **旧回复版本显式切回**：ChatGPT「查看版本」仅有预览与在新聊天创建分支，原会话不存在激活废弃回复的可操作入口；F-01 仍 Open，不把模拟父链通过当作真实激活。
- **浏览器范围**：本轮用户明确排除 Zen、Safari。Helium/Chromium MV3 执行了真实浏览器验收；Windows Node.js 24 验证源码与构建，并不等于 Windows Edge 已登录实机验收。未启动或改写用户既有浏览器 Profile。
- **其它环境**：尚未在独立 Chrome/Firefox/Edge 或 Linux 中执行实际 ChatGPT 登录采集。macOS Node.js 22/25、Windows Node.js 24 的完整测试是独立工具链证据，不能冒充其它浏览器实际加载扩展。
- **真实故障注入**：HTTP 401/403/429/503、网络超时、故障分页、跨页重复 ID、IDB 写入中止和并发变更已由模拟及 `fake-indexeddb` 测试覆盖；没有破坏私人网络状态、修改浏览器登录令牌或主动让实际用户会话失败。影响：真实浏览器恢复仍需实测；补验是在隔离测试 Profile 控制网络并读回已保存数据，不把模拟通过列为实机通过。

文档已对应更新 `AGENTS.md`、`docs/collectors.md`、`docs/storage.md`、`docs/ai-chat-testing.md`；Feature 任务引用与 `todo.toml` 使用现有脚本验证，均在已提交的当前分支 `crth`。
