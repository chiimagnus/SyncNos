# P1｜阶段审查

审查对象：[P1 实施计划](plan-p1.md)。
实时任务状态以 `todo.toml` 为准。

## 结论

- **结果：Go（P1 验收完成；F-01 Deferred，属于当前 ChatGPT 网站不提供的操作）**。
- **依据**：2026-11-14 在授权测试会话中，首次、重复、续聊、重新生成、较早提问编辑、Thinking 设置往返、两标签并发、导航中断与恢复、App/ZIP 读回均有实机证据；最终 E 轮已成功保存并读回。macOS Node 22/25 最新全量门禁均为 3296/3296。用户确认本轮验收完成。旧回复原会话激活入口不存在，属于已接受的平台限制，不将它记作通过。Zen、Safari 按用户要求排除。

## 任务与改动

- **P1-T1**（`a8eb03ed9`）：`tests/unit/chatgpt-api-capture.test.ts` 修正 `metadata.parent_id` 夹具并新增跨分页分支测试；真实 ChatGPT API 只读取结构，确认 `num_turns` 不等于原始节点数，工具密集响应中父链可能在到达用户回合前断开。
- **P1-T2**（`0d2b311d7`）：`api-capture.ts`、`current-page-capture.ts`、`storage-idb.ts`、Background 路由、`models.ts`、Backup import/export 建立原子可信前缀、Thinking 设置快照和轻量尾窗；旧版、DOM 或未确认完整的历史不会伪造可信基准。
- **P1-T3**（`64fcedf9d`，后续修复 `db521fad0`、`bdccfa660`）：完成当前分支有界增量、验证过的尾部替换、并发事务保护、图片按消息键回填。新增生成中完整回合交界回归和长历史有界追加；同步更新数据存储文档。

## 发现项

## 发现 F-07

- 任务：`P1-T3`
- 严重级别：`High`
- 状态：`Resolved`
- 位置：`src/services/bootstrap/current-page-capture.ts:349`
- 摘要：`已完成全量快照没有并发 CAS，可能覆盖另一标签页刚写入的新消息`
- 风险：`真实 Background+IndexedDB 注入并发更新后，较旧的完整 API 快照仍提交成功并删除更新消息，违背并发恢复要求`
- 预期修复：`为高级 API 的完整覆盖也绑定已有消息修订号与校验点并在事务中比较，冲突时不进行破坏性写入`
- 验证：`Red/Green 集成回归：完整 API Snapshot 提交前另一标签写入，拒绝过时快照且保留新消息；Node22/25 gate`
- 解决证据：`83d9cb75c: RED older completed full API snapshot successfully erased a message concurrently stored by another tab; GREEN complete snapshots read fresh revision and checkpoint before final HEAD, atomic transaction CAS refuses stale snapshot and preserves message keys/checkpoint/revision; 119 storage and 4 Background+IDB integration tests green; Node25 gate 3296/3296. Node22 isolated conversations-search baseline 5s timeout is unrelated.`


## 发现 F-06

- 任务：`P1-T3`
- 严重级别：`Medium`
- 状态：`Resolved`
- 位置：`src/services/conversations/background/image-backfill-scheduler.ts:52`
- 摘要：`图片回填失败仍被持久队列确认为完成且不会重试`
- 风险：`warning 或下载异常被 syncConversations 吞掉，core 删除唯一持久队列；无变化 Fetch 无法再次排队，图片无法自动恢复`
- 预期修复：`复用已有 scheduler core 延迟重试，将失败反馈保留到队列，正常成功仍只处理增量键`
- 验证：`scheduler 失败-重试-重启/告警恢复真实队列测试；图片读回；npm run gate`
- 解决证据：`24353a37f: RED warning or thrown image-backfill failure cleared the durable queue; GREEN failed ID delayed 60s while successful siblings removed, retry-on-recovery and worker-restart recovery tested; 8 image scheduler and 17 auto scheduler unit tests, Node25 gate 3296/3296, Firefox build and CLI check exit 0.`


## 发现 F-05

- 任务：`P1-T3`
- 严重级别：`High`
- 状态：`Resolved`
- 位置：`src/services/integrations/chatgpt/api-capture.ts:406`
- 摘要：`无法消歧的兄弟分支仍可能以 partial 快照写入废弃分支消息`
- 风险：`有 sibling 但父链不完整时，onPage/最终部分追加能把旧分支写入正式会话，违反仅当前分支`
- 预期修复：`无法确认选中分支时禁止混合快照进入暂存和持久化，保持既有正文并显式报错`
- 验证：`完整入口-Background-IndexedDB 回归：跨页和同页缺失父链 sibling 不写入旧分支且 revision 不变；npm run gate`
- 解决证据：`83d9cb75c: RED unresolved sibling branch entered live IndexedDB instead of refusing; GREEN completed ambiguous branch errors before onPage persistence, prior message keys/checkpoint/revision unchanged; UI error localized. API tests plus 4 real Background+fake-indexeddb integration tests green; Node25 gate 3296/3296.`


## 发现 F-04

- 任务：`P1-T2`
- 严重级别：`High`
- 状态：`Resolved`
- 位置：`src/services/integrations/chatgpt/api-capture.ts:69`
- 摘要：`用户附件 ID 变化不会使可信锚点签名失效`
- 风险：`同名同类型文件替换后仍可能提前停止分页，保存非权威当前分支历史`
- 预期修复：`使用稳定的原始附件身份参与 userSignature，同时保持签名不包含临时链接`
- 验证：`真实 API 形状单元测试：同名同 MIME 不同文件 ID 的签名及回退；npm run gate`
- 解决证据：`83d9cb75c: baseline RED (same-name/same-MIME attachment file-ID replacement and same-Markdown/different-raw-parts both incorrectly trusted); GREEN (stable raw content, attachment file IDs/parent signed, ephemeral URLs ignored), 87 API unit tests and 4 Background+IDB integration tests green. Node25 npm run gate 372/372 files, 3296/3296 tests, build/check-dist exit 0; Node22 full gate 3295/3296, unrelated conversations-search 5s timeout.`


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
- 状态：`Deferred`
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

- **旧回复版本显式切回**：ChatGPT「查看版本」仅有预览与在新聊天创建分支，原会话不存在激活废弃回复的可操作入口；F-01 已 Deferred，用户接受此站点限制，不把模拟父链通过当作真实激活。
- **浏览器范围**：本轮用户明确排除 Zen、Safari。Helium/Chromium MV3 执行了真实浏览器验收；Windows Node.js 24 验证源码与构建，并不等于 Windows Edge 已登录实机验收。未启动或改写用户既有浏览器 Profile。
- **其它环境**：尚未在独立 Chrome/Firefox/Edge 或 Linux 中执行实际 ChatGPT 登录采集。macOS Node.js 22/25、Windows Node.js 24 的完整测试是独立工具链证据，不能冒充其它浏览器实际加载扩展。
- **真实故障注入**：HTTP 401/403/429/503、网络超时、故障分页、跨页重复 ID、IDB 写入中止和并发变更已由模拟及 `fake-indexeddb` 测试覆盖；没有破坏私人网络状态、修改浏览器登录令牌或主动让实际用户会话失败。影响：真实浏览器恢复仍需实测；补验是在隔离测试 Profile 控制网络并读回已保存数据，不把模拟通过列为实机通过。

文档已对应更新 `AGENTS.md`、`docs/collectors.md`、`docs/storage.md`、`docs/ai-chat-testing.md`；Feature 任务引用与 `todo.toml` 使用现有脚本验证，均在已提交的当前分支 `crth`。

## 2026-11-14 独立逐提交复核

本节从 `todo.toml`、需求、Git 差异及当前源码重新建立证据链，未以先前审计的结论为判断前提。`todo validate` 通过，P1-T1～T3 均为 completed。

| 提交 | 对应任务 | 本轮核查的实际作用 |
| --- | --- | --- |
| `ea12473ba` | 计划 | 建立需求与任务文档；非生产代码。 |
| `a8eb03ed9` | T1 | API 测试夹具真实写入 `metadata.parent_id`，分支场景不再只是声明父链。 |
| `abc2490b7` | T1 | 任务状态文档；非生产代码。 |
| `0d2b311d7` | T2 | 可信锚点、持久消息修订号、精简尾窗、事务 CAS；串通 Background 与 IndexedDB。 |
| `996e30e53` | T2 | 计划进度文档；非生产代码。 |
| `64fcedf9d` | T3 | 当前分支分页、交界停页、HEAD 校验、页面暂存、最终替换、图片回填入口。 |
| `d643dfc86` | T3 | 计划进度文档；非生产代码。 |
| `f7f9c60a0` | 验收记录 | 仅记录检查证据，不新增运行入口。 |
| `3a0a1ddff` | 验收记录 | 仅更新验证记录，不新增运行入口。 |
| `db521fad0` | T3 | 保护性追加改为反向游标及逐键读，避免扫描一万条旧消息。 |
| `bdccfa660` | T3 | 生成中新增用户的助手交界改用锚点与下一用户之间的旧助手。 |
| `6bb7391d8` | 验收记录 | 验收矩阵更新；Zen、Safari 排除在本轮范围外。 |
| `b245da93c` | T3 | 删除重复的 API 响应校验。 |
| `6264aa9d3` | T3 | 删除重复的父链循环计数。 |
| `021b4f2ed` | T3 | 删除重复排序与消息键集合。 |
| `b21f13652` | T3 | 收敛捕获完整性检查，继续经统一入口生效。 |
| `c19ed483b` | T3 | 精简尾窗响应中未消费的字段。 |
| `83d9cb75c` | T2/T3 本轮修复 | 稳定原始锚点身份、拒绝歧义分支、完整与增量快照事务并发保护。 |
| `24353a37f` | T3 本轮修复 | 图片失败任务持久延迟重试，仅重试失败会话。 |

生产调用链已从 CodeGraph 源码和集成测试核实：当前页 Fetch → ChatGPT MAIN world API → 分支快照 → Background 路由 → IndexedDB 消息与校验点事务 → 图片补全调度。默认 DOM 采集与非 ChatGPT 源仍为真实业务入口，不能当作废弃兼容层删除；已有校验点、HEAD、导航及消息修订保护均有确定作用。未发现可安全直接删除的另一套 Advanced 旧采集实现。

### 本轮修复与 Red→Green

- F-04：同名同 MIME 的附件替换、同一 Markdown 的不同原始 parts，修复前错误信任旧锚点；修复后分页回退，临时下载 URL 变化不误判。
- F-05：父链缺失且出现兄弟节点时，修复前混合快照可落库；修复后拒绝采集，原消息、修订号与校验点不变。
- F-06：图片告警或异常发生后，修复前任务从持久队列消失；修复后失败会话延期一分钟重试，成功会话不重扫，重启后队列仍可恢复。重启时内存丢失的逐键范围可能退回完整扫描，该非正常恢复路径尚未承诺增量性能。
- F-07：完整 API 快照与另一标签页写入竞争时，修复前旧快照覆盖新消息；修复后完整替换同样经过事务 CAS，旧消息不删除，新写入与修订号保持不变。若冲突则明确要求重新 Fetch。

### 实际验证及 Gate

- **macOS / Node 25.9.0**：`npm run gate` exit 0；372/372 测试文件、3296/3296 测试；ESLint、Prettier、TypeScript、Chromium 构建及 `check:dist` 均通过。日志 `/tmp/syncnos-gate-node25-audit.log`。
- **Firefox MV3 构建**：`npm run build:firefox` exit 0；**CLI**：`npm run cli:check` exit 0。
- **macOS / Node 22.22.2**：最终复跑 `npm run gate` exit 0；372/372 测试文件、3296/3296 测试、完整构建及 `check:dist` 均通过。日志 `/tmp/syncnos-gate-node22-audit-retry.log`。前两轮分别出现 CLI 文件往返与 2105 会话搜索的 5 秒超时（记录在 `/tmp/syncnos-gate-node22-audit.log` 及先前命令输出），独立 CLI 复跑 2/2 通过，搜索单跑约 5.17 秒仍失败一次；属于尚需单独治理的测试时限裕量问题，不伪称先前失败不存在，也未调整无关搜索代码或放宽超时。
- 已执行单元与 Background＋`fake-indexeddb` 集成：首次完整、继续增量、历史编辑、再生成、生成中转完成、分支歧义、附件身份、并发 CAS、图片失败重试/重启，以及 10000 条旧消息的局部保存。检查结果包括消息键、正文、修订号、持久队列，非仅检查退出码。
- **未验收**：在原会话中显式激活旧回答版本（网站界面没有该操作）、真实图片缓存失败重试（当前用户设置为关闭）、控制式 HTTP 故障、以及 Windows/Edge 的本轮新源码实机采集。Zen、Safari 依用户要求排除。

### 真实浏览器复验（2026-11-14 18:08 之后）

目标：macOS / Helium / Chromium MV3；已获准使用的既有 E2E 测试会话。未向模型发送新请求或改变私人对话。未记录消息正文与凭据。

- **版本证据**：在 Helium 的 `chrome://extensions` 中找到启用的本地 unpacked SyncNos，其源目录是本仓库 `.output/chrome-mv3`。点击「重新加载」，确认新 Service Worker 启动；运行时 `background.js` 与磁盘构建 SHA-256 相同（`39202b20c60af882877f28a6d1ed6cfca789479a1e45acfa9854efec12eb1e79`），并通过 `getCurrentPageCaptureState` 返回 `chatgpt`。
- **完成态增量**：经真实 Content Script `captureCurrentPage` → Background → IndexedDB 返回 `complete`。原会话 24→26 条（13 user / 13 assistant），保存前记录的首尾 key 均保持；先前尚未保存的 E 测试回合及回答写入，最新用户校验点推进。首次旧校验点签名已升级，因此真实网络观察到一次完整分页回退，不能将这轮记作零旧页。
- **幂等与性能**：再次抓取返回 `complete`，仅最新 10-turn 页与两次 1-turn HEAD，未请求 `before` 旧页。26 条消息、Markdown 顺序/正文 SHA-256、消息修订号 1619、会话修订号 3633、`lastActivityAt` 与校验点全部保持不变。
- **App 读回**：通过当前同一 unpacked 扩展的 App 真正打开该会话；可读到 C、D、E 三轮 E2E 标记，E 的完整尾段包含到 850，没有只依赖 DB 计数断言。
- **双标签并发**：两个不同测试标签页同时经 `captureCurrentPage` 真实抓取，同返回 `complete`（约 11.8 / 15.7 秒）。复读仍为 26 条且内容哈希、两类修订号和校验点不变，无重复写入。
- **导航中断→恢复**：在自己创建的第二测试标签发起 Fetch 后约 500ms 离开会话，消息通道关闭，源会话消息与两类修订号保持不变；重新导航回来，再次真实 Fetch 成功，`complete`（约 13.3 秒），内容和修订号仍不变，未向旧页翻页。
- **旧版本 UI（F-01）**：在该测试会话真实点击「查看版本」，界面显示「版本 1」、上一/下一版本、返回当前版本及「在新聊天中创建分支」，**没有在原会话激活该旧版本的入口**。只读查看后 Escape 退出，未创建新聊天，未篡改当前分支。F-01 标记 Deferred：等待站点提供入口时再测，用户已接受不阻塞 P1 的限制。
- **边界**：真实 HTTP 429/503 注入、真实附件替换与图片失败自动恢复未在用户账号上制造故障；这些只具有前述匿名输入与 IndexedDB 集成测试证据，不冒充生产故障验收。

**Gate：Go（P1 验收完成，保留已接受的限制）**。用户已确认验收完成；Helium 最新扩展真实验证增量补全、重复幂等、App 读回、双标签并发与中断恢复，Node 22/25 全量门禁通过。F-01 的旧回复原会话激活因 ChatGPT 当前没有相应入口而 Deferred；真实 HTTP 故障注入、关闭状态下的图片缓存失败恢复及其它浏览器实机未覆盖，仅有自动化回归或构建证据。以上均不计作已测试通过，也不再阻塞用户确认完成的 P1 范围。
