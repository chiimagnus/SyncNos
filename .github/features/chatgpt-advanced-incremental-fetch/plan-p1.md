# P1｜让 ChatGPT Advanced 只获取尚未保存的对话尾部

首次完整保存之后，Fetch 从最新消息往前读取；找到可信的旧历史交界点便停止，
只更新当前分支尾部。找不到交界点时继续沿用原来的完整分页。
完整需求见 [idea.md](idea.md)。

## 现状与方案

### 已有能力，不再重造

现行流程是 `captureCurrentPage()`（`src/services/bootstrap/current-page-capture.ts`）
→ `captureCurrentChatgptConversationViaApi()`（`src/services/integrations/chatgpt/api-capture.ts`）
→ `buildChatgptApiSnapshot()`（`api-snapshot.ts`）
→ `saveSnapshot()` / `resolveCaptureIntegrity()`
→ `SYNC_CONVERSATION_MESSAGES`
→ `syncConversationMessages()`（`src/services/conversations/data/storage-idb.ts`）。

- API 已按每请求最多 10 turns 从新向旧分页；`onPage` 已将部分历史分批追加保存。
  目前没有本地停止条件，每次都读到远端历史末页。
- 已有 `GET_CONVERSATION_TAIL_WINDOW_BY_SOURCE_AND_KEY`，通过 IndexedDB 逆向游标最多读取最近 200 条；
  不需要全量加载本地对话或新增查询消息类型。
- 存储已支持按精确消息 key 增删的 `incremental`，且使用 `runTrackedTransaction()` 原子写入数据与 revision。
  `snapshot` 会删除不在本次结果中的历史，`append/reconcile-existing-order` 会读取整段历史；
  **可信局部尾部不能误用这两种写入方式**。API 采集结果必须显式区分“完整历史”
  与“已验证的当前分支尾部”，不能把局部尾部标记为普通完整 `captureMeta` 后交给 `saveSnapshot()`。
- 用户消息采用原始 API ID；assistant 可能有独立 ID、临时 `chatgpt-turn:` key，
  AI 生图可能用由文件 ID 派生的 key。思考和工具进度还依赖相邻回合归属，
  因此交界不能任选一条重复消息，必须以完整的 user 回合为边界。

### 仅保存最小的“曾完整采集”证据

本地已有消息不等于历史完整：默认 DOM 始终是 partial，旧 Advanced 分页也可能中断。
只给**经 Advanced 完整采集并成功落库**的 ChatGPT conversation 保存一个可选的可信交界：
`lastUserKey` 和该 user 的稳定语义签名。二者放在现有 conversation 行，不建新 store、索引、设置或迁移。
`sequence` 直接从尾部消息读取，**不额外持久化 sequence 或版本代数**。

签名取自原始 API 用户内容、稳定附件/图片身份及可用的 `metadata.parent_id`，
并包含会改变已保存历史的 Thinking 设置值。不能只比较用户消息正文；
不能采用会变化的 `syncnos-asset://` URL、临时签名图片 URL 或下载结果。
设置变化、同 ID 改正文/附件/父节点均应使旧交界失效。使用既有平台摘要能力，
不存原始 backend 对象、Cookie 或 Bearer Token。真实 API 若无父节点信息，
不得把“消息 ID 相同”当成跨分支连续性的充分证明。

首次确认须满足 `captureMeta.completeness === 'complete'`、既有最新节点复核、
富组件补充和消息事务成功；在**同一事务**内写入交界证据。
该证据仅证明**交界点及之前的历史前缀**，不声称之后的新尾部都已经完成。
因此，已找到可信交界的 Advanced 生成中/部分采集，可仅安全追加尾部并保留原交界，
**不得删除旧尾部或推进交界**；下一次 Fetch 仍从该交界增量恢复。
无法证明未改动可信前缀的 DOM/其它部分写入、Backup 导入或会话合并应在消息事务中使证据失效；
图片缓存补全不因 URL 改写就使历史失效。缺字段的旧记录首次完整 Fetch 后自然建立基准。

备份出口 `src/services/sync/backup/export.ts::stripLocalConversation` 会复制整条 conversation；
新交界证据是本机派生状态，应由这里排除，不能意外进入 ZIP。
Backup 导入当前会合并消息，涉及会话必须清除旧交界，不能假设导入消息与原链一致。

### 只比较尾部，不建新同步系统

1. 已有可信交界时，通过现有尾窗定位最后一个可信 user 的持久 ID、sequence 与其后的消息。
   `GET_CONVERSATION_TAIL_WINDOW_BY_SOURCE_AND_KEY` 现会传完整 Markdown，
   且自动保存回填确实依赖正文；只给 Advanced 增加**可选的轻量投影参数**，
   返回键、顺序及并发校验摘要，默认行为不变，避免 200 条超长正文进入 IPC。
   继续使用现有消息类型与索引，不建立第二套缓存。
   user 不在尾窗、历史顺序或身份异常，直接走完整分页。
2. 继续用现有接口从最新向前分页，直至出现**相同 user ID 与稳定语义签名**。
   从该 user 开始交给现有 `api-snapshot` 投影，保留思考、附件与纯生图的归属；
   只以投影后的结果生成新尾部。
   同 ID 的最后一条提问发生内容变化、旧 user 不再属于当前分支，继续完整翻页。
3. 对**当前分支**作判断：保留既有重复 ID / 游标 / `current_node` 校验；
   sibling 能据现有父链信息明确排除时只保留当前链，无法消歧时不执行尾部删除。
   分支判断必须使用**过滤之前的原始 API 节点**（含隐藏节点与工具节点），
   不能在仅供渲染的消息数组上猜测父链。
   `metadata.parent_id` 缺失本身不是缺页或错误——`01d316f3f` 和相应回归已经证明这一点。
   是否能在真实分页中可靠识别 selected branch 由 T1 先取证，不预设新分支树管理器。
4. 校验通过后，把 user 之前的本地历史保留，把 user 之后的尾部与新投影**按 key 精确比对**；
   仅对可信、稳定的完整尾部执行 `incremental` 精确增删。
   生成中或 schema 不确定的尾部只可执行现有保护性追加/更新，不删除旧消息或推进交界。
   新尾部的 sequence 为**旧 user.sequence + 相对原始投影序号**；
   Thinking 过滤后的合法空缺必须保留，防止下一次全量采集或导出时序号改变。
   不能靠正文相同猜测别名，也不能把旧分支继续 append 到末尾。
5. 写入事务内再次核对之前读取的**交界证据与实际本地尾部**，
   防止其它标签页、图片回填或导入在读取后改动消息。注意图片回填可能改变 Markdown
   却保留 `updatedAt`，只比键或时间戳是不够的。
   使用已有 `runTrackedTransaction()` 和有界键/序号索引，在事务内比较真实旧尾部；
   **不加独立世代计数、锁服务、第二套 revision 或整段 getAll**。
   同一标签页原有 `enterManualPersistence()` 已串行化手动 Fetch，继续复用。
6. 提交前保留并正确触发最新 HEAD 检查、SPA 导航身份校验和图片缓存流程。
   现有 HEAD 核验只在 `page_info.has_previous_page === false` 的完整抓取触发；
   **提前停止的可信尾部必须显式执行等价核验**，不能因为没有抵达历史末页就跳过。
   采集开始时固定一次 Thinking 设置，保存前再确认；当前头节点或该设置在读取中变化，
   不能提交过期的权威尾部。现有 `saveSnapshot()` 在每次分批暂存时单独读取 Thinking 设置，
   必须避免同一轮 Fetch 因设置中途变化混合两种历史投影。
   若交界未匹配，使用**同一次分页**读到最早页；把已读页面回交现有 `onPage`
   安全暂存后继续获取旧页，不另起一轮完整请求。
   候选增量在定位交界前不得破坏旧历史；若网络中断，已读且可独立安全暂存的页
   仍应按原有 partial-safe 机制落库，并在无法证明前缀未变时清除交界；
   不允许把失败前的缓存页冒充完整快照。
7. 未变化时不写库、不改变 `lastActivityAt`/revision、不发送无意义的远端通知。
   现有 `syncConversationMessages()` 的 `upserted` 统计包含未实际改写的记录，
   Background 还会无条件触发 `onConversationChanged`；必须以事务确认的真实消息变化
   **或真实会话元数据变化**决定通知，不能为了消除空同步漏掉标题更新。
   新增未缓存图片会经 `handlers.ts::scheduleImageBackfill` 进入
   `image-backfill-job.ts::backfillConversationImages()`，**该函数确实调用全会话读取**。
   正常增量必须让该后续恢复聚焦本次新增/未完成图片关联的消息，
   同时保留历史旧图可恢复的路径；针对无法完成的持久任务仍需正确重试。
   三次重复 Fetch 同一张下载失败的图片不能造成三次无意义的全历史扫描。
   这属于本次性能根因，不准以“后台任务”作为例外，也不新建独立同步框架。

现有 API 首次页 / `before` 接口、完整回退的逐页暂存、`captureSequencePolicy` 和
`preserve-existing-content` 的公共语义仍被其它真实路径使用，**不能作为“老旧兼容代码”盲删**。
历史的 `/backend-api/conversation/{id}` Mapping 路径与 `api-live-tail.ts` 已在 `3f80ca18f` /
`01d316f3f` 删除，不恢复它们。仅删除被本次实现实际取代的重复分支、临时状态和死代码，
在其所属任务中同时删除旧测试；不单设“最后清理”任务。
两次 HEAD 检查与 MAIN world/Background 的源身份检查也不能仅因重复就删：
`5d19b6e62`、`008133ca9`、`d6385dd1e` 均有明确故障背景；必须证明不变量仍被覆盖才能合并。

## 任务

<a id="p1-t1"></a>
### P1-T1 核实分页分支契约与锚点可用性

**阅读与证据**：
`src/services/integrations/chatgpt/api-main-fetch.ts::fetchChatgptPageInMainWorld`、
`api-background-handlers.ts::registerChatgptApiHandlers`、
`api-capture.ts::captureCurrentChatgptConversationViaApi`、
`api-snapshot.ts::currentPageMessages/buildChatgptApiSnapshot`；
现有 `tests/unit/chatgpt-api-capture.test.ts`、`tests/unit/chatgpt-api-main-fetch.test.ts`、
`tests/unit/chatgpt-api-background-handlers.test.ts`。

先修正既有 fixture 的前提：`tests/unit/chatgpt-api-capture.test.ts::message()`
声明了 `parent` 参数，却没有写入返回消息的 `metadata.parent_id`；必须让构造器真实表达
父节点关系，否则“分支测试通过”可能只是夹具遗漏。
用匿名分页 fixture 分别验证正常追加、同 ID 用户编辑、再生成、历史回复分支切换、
同页/跨页 sibling、缺失/变化的父节点、10 turns 与原始消息数不相等、隐藏 tool 尾节点、
长工具链以及思考/生图跨页归属。不能靠仅有字符串 ID 的假分支夹具证明可删旧消息。
获授权的专用测试会话可用时，再只读核对真实 API 的 `current_node`、父链、分页顺序与
`include_has_versions=true` 的 sibling 行为；不编辑私人对话、记录正文/凭据或未经同意调用付费模型。

**完成判据**：确定哪些 API 形状能证明当前链、哪些必须保守回退；
回退全量后仍无法判定分支的，明确标记为**需求验收阻塞**，不能宣称“分支切换已解决”。
同任务修正 `tests/storage/conversations-idb.test.ts` 中早已删除的 API live-tail 旧术语，
保留有效的“部分暂存→完整保存”防重回归；不重启旧 Mapping 协议。

<a id="p1-t2"></a>
### P1-T2 建立原子可信校验点与有界本地读取

**修改位置**：
`src/services/bootstrap/current-page-capture.ts::captureCurrentPage/saveSnapshot`、
`src/services/integrations/chatgpt/api-capture.ts`、
`src/services/conversations/background/handlers.ts::registerConversationHandlers`、
`src/services/conversations/data/storage-idb.ts::syncConversationMessages/getConversationTailWindowBySourceAndKey`、
`src/services/sync/backup/{export,import}.ts`、
`src/services/conversations/data/storage-idb.ts::mergeConversationsInTransaction`。

完整 Advanced 成功后，经**现有** `SYNC_CONVERSATION_MESSAGES` 在消息事务中建立可信前缀；
尾窗读取仍复用当前 IPC 类型；只在 Advanced 明确请求轻量投影时返回摘要，
**默认完整消息响应必须保持不变**，因为
`src/services/bootstrap/content-controller.ts::reconcileAutoSaveBackfill` 依赖旧正文。
增量不得把 200 条历史长 Markdown 送到 Content Script。
必须处理真实的所有者变更路径：普通 `upsertConversation` 对既有行的字段保留、
`upsertConversation` 隐式合并、显式 `MERGE_CONVERSATIONS`、DOM 追加、
Backup merge restore、图片补全以及另一个标签页写入。
只有无法证明可信前缀未动时才清除标记；可信尾部的未完成追加不清标记。
Backup ZIP 必须排除本机校验点；JSON/Markdown 导出使用显式字段，仍要测试不外泄。
此任务同时清理实际失去用途的状态和无消费者代码，不保留兼容别名，
不引入代数、额外 store、迁移、锁服务或第三方依赖。
可信前缀的恢复边界同任务更新 `docs/storage.md`，不留到阶段末尾。

**完成判据**：真实保存入口经 Background → IDB 读回可复用的可信前缀，
不存在跨事务“消息失败但基准成功”；未验证的初次部分采集/导入不能伪造基准，
已有可信前缀不会被无害的图片补全或自身尾部临时消息误清。
基准字段不进入 Backup，关闭思考设置不会悄悄沿用旧正文；
无变化不推进活动时间与 revision。
覆盖 `tests/storage/conversations-idb.test.ts`、`tests/storage/data-revisions.test.ts`、
`tests/domains/backup-service.test.ts`、`tests/domains/backup-utils.test.ts`、
`tests/smoke/background-router-conversations.test.ts`、
`tests/smoke/content-controller-ai-chat-autosave-backfill.test.ts`、
`tests/unit/image-backfill-job.test.ts`；本任务不启用提前停页。

<a id="p1-t3"></a>
### P1-T3 提前停页并原子替换当前分支尾部

**修改位置**：
`src/services/integrations/chatgpt/api-capture.ts`、
`api-snapshot.ts`（仅在 T1 证据需要调整回合切口时）、
`src/services/bootstrap/current-page-capture.ts`、
`src/services/conversations/background/handlers.ts`、
`src/services/conversations/data/storage-idb.ts::syncConversationMessages`；
图形补充由现有 `src/collectors/chatgpt/chatgpt-collector.ts::enrichApiSnapshotWithRenderedGraphics` 接管。

有可信交界时提前停页，只投影从完整 user 开始的尾部；
采集层用最小的区分结果（完整历史 / 已验证尾部）传递交界证据，
保存入口仅在已验证尾部路径采用 `incremental` 与精确删除范围，
绝不能将局部结果当成完整历史的 `snapshot`。
完整且分支明确时才精确删改并推进交界，生成中/结构不完整时仅安全追加、保留交界，
旧回复绝不能被临时内容误删。候选增量在确认交界前不落破坏性写入；
读取失败时仍能使用原有按页安全暂存；找不到交界就在同一次 API 分页继续全量。
在 IDB 同一事务比较旧交界与尾部、提交真实差量和更新前缀；
后台只在真实消息/会话变更时通知 Provider，标题单独改变仍须通知，
不能以 `upserted` 的请求数量代替实际变更数。保留原图片缓存/回填语义，
修订 `image-backfill-job.ts` 与现有调度/消息持久化的作用范围，
将新产生的图片恢复限定到确定的增量消息，不重扫全部旧正文；
保留旧图未完成恢复、任务重试和浏览器重启后的完整性，不能凭“图片回填已排队”就判完成。
补足从内容入口 → Background → fake-indexeddb → 重新读取/导出/Provider 通知的**完整链测试**，
对比相同输入的权威完整采集结果，而非只断言调用了 `incremental`。
**同任务删除实际被取代的兼容、重复协调和旧测试**，不保留双套增量写入方案。
同步更新 `AGENTS.md`、`docs/collectors.md`、`docs/storage.md`、
`docs/ai-chat-testing.md`：写清旧文档“完整快照才能删除”的例外仅适用于已验证的当前分支尾部；
明确「首次/回退仍逐页安全暂存，可信增量只在验证后原子写入」。
不增设入口按钮、设置项或 UI 文案。

**完成判据**：固定 130 页乃至 1000 页历史，只增加 1 轮且交界位于首页时，
只请求首页及必要的 HEAD 核验（而非再次读取全部旧页）；
正常纯文本与含新图片的增量均量化 IDB 读取、IPC 体积、后台恢复次数和通知次数。
正常增量不能调用整段 `by_conversationId_sequence.getAll`；
以权威全量结果对照真实 DB 的 key、role、Markdown、顺序、图片、元数据、活动时间和 revision，
删除旧尾部只能影响明示的分支范围。
覆盖 `tests/unit/chatgpt-api-capture.test.ts`、`tests/unit/chatgpt-api-main-fetch.test.ts`、
`tests/unit/chatgpt-api-background-handlers.test.ts`、
`tests/smoke/current-page-capture-integrity.test.ts`、`tests/storage/conversations-idb.test.ts`、
`tests/unit/image-backfill-job.test.ts`、`tests/unit/image-backfill-scheduler.test.ts`、
`tests/integration/reload-free-data-consistency.test.ts`、
`tests/smoke/content-controller-ai-chat-autosave-backfill.test.ts` 和相关 thinking/backup/导出测试。

## 阶段验收

先用真实前提可断言的 fixture 证明旧实现每次读到历史末尾（Red），
再验证提前停页和最终本地结果（Green），最后清除被替代实现（Refactor）。
每种环境能运行的适用条件都执行，组合过多时先覆盖各取值与极值，
再覆盖所有已知故障交互、两两组合与关键三因素交互，不用几条普通用例冒充全面验收。

### 测试条件和极端值

**浏览器、运行时与入口**

- 浏览器：Chromium（Chrome、Edge、Helium）、Firefox、Zen、macOS Safari。
  分别检查正式 MV3 扩展的 Content/Background/MAIN world、注入结果、安装权限、
  后台休眠与恢复、刷新和重启；Safari 必须有原生宿主实测，构建成功不等于采集成功。
- 工具链与主机：macOS Apple Silicon、Windows x86_64/Edge、CI Linux Node.js 22、
  发布 Node.js 24，以及实际支持的系统/浏览器版本。检查最低支持版本及开发/正式构建。
  Windows 当前有 Edge 与 Node.js 24，但 `D:\\GitHub\\SyncNos` 仓库不存在，
  不能在不建立项目副本的情况下直接复用同一提交测试；不要将其记作已通过。
- 页面：悬浮 Fetch、Popup/应用 Fetch、已有快捷键/CLI 入口；
  Advanced 开/关、默认 DOM、站点授权有/无、登录失效、MAIN 注入失败；
  正式会话 `/c/{id}`、Project `/g/.../c/{id}`、首页、分享页及临时会话。
- 导航：SPA 首页→会话、两会话互切、普通↔Project、返回/前进、刷新、关闭；
  `sender.url` 仍是旧页面但当前 tab 已变化、每页/写入前切换路由、离开再返回。
  不能跨会话保存，也不能把 Session Token 带出 MAIN world。

**历史、数据形态和容量**

- 本地历史：全新、可信完整、旧版无校验点、DOM 部分、Advanced 中断、
  临时思考、缺失历史、重复保存、Backup 导入、隐式/显式会话合并、孤立消息恢复。
- 校验点：缺失、正常、损坏、错误 conversation、签名/父关系变化、没有可用 user、
  锚点已被删除；尾窗 0/1/199/200/201、锚点超过 200 条范围。
  检查序号从 0 开始、合法空缺、重复、逆序、缺失、极大合法值和尾窗正文投影兼容。
- 页数和内容量：0/1/9/10/11 turns、多页/跨 10 turns 新增、只有旧页存在 user；
  `num_turns=10` 不等于 10 个原始消息节点；130 页、≥1000 页、≥10000 条消息，
  单回合数百工具节点、超长文本、多图及一页只有隐藏消息。
- API 格式：空消息页、缺失/错误 `page_info`、游标不前进/循环、start/end 不符、
  跨页重叠或重复 ID、缺消息 ID、错误 `conversation_id`、`current_node` 错位、
  当前隐藏节点、未知内容字段；均不得被误判为完整历史。

**内容、分支与设置**

- 普通变更：不变、只变标题、增加 1/多个 user、只有 user、最终 assistant 同 ID 改正文、
  不同 ID 再生成、最后提问以同 ID/新 ID 编辑；和权威全量结果逐消息比较。
- 当前分支：当前链、sibling 同页/跨页、完整/缺失/变化的父关系、
  切到旧分支再切回、最后 user 相同但祖先不同。无法证明当前链时不允许删旧尾部。
- 思考和工具：纯思考、commentary、`reasoning_recap`、无 `turn_id`、无 final、
  隐藏 tool、数百工具节点；Thinking 开→关→开、采集中切换、
  不完整→最终完成，检查思考归属和合法 sequence 空缺。
- 图片/富内容：用户上传/AI 生图、同一图片重复引用、纯生图、隐藏工具截图排除、
  缓存命中/下载失败/后台补全、旧图恢复；附件、DIL、公式、图表、引用、代码围栏、
  保留原文缩进、Unicode/Emoji。导出文件中的图片实际可读取。
- 大体积 IPC：单条数 MB 的 Markdown、200 条尾部消息总正文很大、
  多轮生成图/附件；Advanced 轻量尾窗不传旧正文，原有自动保存的完整尾窗仍能正常工作。

**故障、时序、持久化和最终结果**

- HTTP：离线、DNS/连接中断、超时、408/425/500/503 仅重试一次、
  401/403/429 不误重试、Session 字段错误、HTTP 成功但非 JSON；
  第一页、中间页、交界页、HEAD 各位置失败和重试。
- 远端时序：第一页后新增消息、相同最新 ID 的正文/状态变化、
  HEAD 首次一致第二次不一致、富图处理期间变化、导航和关闭；
  不能提交过期的权威尾部。
- 本地事务：quota/abort/ConstraintError、提交后回包丢失、Background 中断、
  双标签页同时 Fetch、与 DOM、Backup/合并、图片回填竞写；
  核对完整原子回滚、失效交界拒删、下次重试可恢复。
- 结果与副作用：Conversation ID、role/key/作者/sequence、Markdown、图片哈希、
  标题、`lastActivityAt`、消息/会话 revision；局部不能走全局 `snapshot` 删除；
  无内容/元数据变化不写库、不产生无意义远端通知，只变标题仍要同步。
  App/CLI、JSON/Markdown ZIP、Backup ZIP、Provider 原有输出均要读回核对。

### 必须组合复测的同根因路径

- **长对话 × 轻量续聊 × 重复 Fetch**：130 页与 ≥1000 页分别运行 0/1/11 turns 新增量，
  证实只有新增页 + 必要 HEAD 请求，并用真实 IDB 访问计数排除全量 `getAll` 和全历史重排。
- **改写/分支 × 分页边界 × 不完整父链**：尤其是同 ID 用户编辑、最后 assistant 再生成、
  sibling 分布不同页；与**独立完整采集**比较全部消息 key、角色、序号与正文，而不只比数量。
- **生成中 × 部分页失败 × 下次完成**：已验证的旧前缀仍可信，新尾部可安全暂存，
  失败不删旧回答，重试仍可增量结束，不强迫无意义的长历史全量扫描。
- **Thinking 开关 × 纯思考 × 跨页 × 导出**：验证无隐藏正文残留、合法 sequence 空缺、
  Markdown/JSON/Backup 各自语义与全量相同；采集中途切换须明确失败或重新校验。
- **新生成图 × 缓存未命中 × 网络断开 × 后台重启**：先保存可恢复图片身份，
  完成恢复后图片实际可读，衡量后台扫描量；不能用“写入成功”替代图片 read-back。
- **跨标签页 × 同一交界 × 回复分支变化 × IDB 事务中止**：过期任务不能删除新任务结果；
  重新读取完整历史后结果唯一且与最新当前分支一致。
- **SPA 导航 × session 失效 × retry/HEAD**：错误必须被真实入口传回，
  不改用 DOM，也不向另一会话写入。
- **备份导入/合并 × 存储标记 × 再次 Fetch**：恢复后基准失效且会安全重新全量，
  与导入前的未变会话 ID/其它来源消息、已有图片和 Provider 映射保持一致。

### 性能与完成门槛

在固定的 ≥130 页和 ≥1000 页历史上，交界位于首个 10-turn 页时，
**0/1 turns 新增**的 ChatGPT 会话分页请求应固定为最新页加必要 HEAD 复核
（当前链路通常最多 3 次 backend page GET）。注意 `api-main-fetch.ts` **每次还会 GET `/api/auth/session`**，
所以对应的实际 HTTP GET 通常最多 6 次；两种计数必须分开报告，
不能用“3 次请求”误导。总历史多 10 倍不得多抓旧页；超限需解释页和原因。
新增跨 N 页时只读取对应的 N 页、交界页和 HEAD；
统计完整的后台注入、Session GET、API GET 与重试，不能把重复调用藏在成功计数外。

同时用真实 `fake-indexeddb`/IDB 请求插桩证明：正常可信增量不调用整历史
`by_conversationId_sequence.getAll`，仅触及受影响尾部；
尾窗 IPC 负载不随旧消息正文体积增长，图片后续恢复不得每次重复全历史扫描。
比较变更前后消息和 conversation revisions、Provider 通知、图片存储和导出，
要求无变化时没有伪活动时间或多余写入。使用现有测试框架以固定随机种子
组合生成选中分支/分页/失败插入点，覆盖不同 sibling、隐藏节点及有效/无效父链；
每次以全量投影为 oracle，不依赖为实现而写的同一差量算法。生产构建必须继续满足既有包体预算，
不允许为新增逻辑直接调大阈值。
性能检查必须包括最终副作用，不能只验证 API 少发了几次请求。

**验收阻塞与证据**：每个未跑的实际适用浏览器/版本、需要测试账号而不能安全访问的
真实分支操作、无法控制的 API/网络/IDB 失败场景，以及 Windows 缺少同一测试仓库副本，
都记录尝试、阻塞原因、影响、
可替代的 fixture、补验条件和是否阻塞验收；不要用 Vitest/构建通过标记真实 E2E 通过。
分支切换后仍可能混入非当前历史、丢失已存正文或误删旧消息，均阻塞本功能完成。

至少运行下列定向测试与项目要求的完整门禁；生产修改后重新运行，不能挪用规划阶段旧版本的通过记录：

```bash
npm run test -- --run \
  tests/unit/chatgpt-api-capture.test.ts \
  tests/unit/chatgpt-api-main-fetch.test.ts \
  tests/unit/chatgpt-api-background-handlers.test.ts \
  tests/unit/chatgpt-api-image-assets.test.ts \
  tests/unit/chatgpt-conversation-image-assets.test.ts \
  tests/unit/capture-integrity.test.ts \
  tests/unit/thinking-block.test.ts \
  tests/unit/image-backfill-job.test.ts \
  tests/unit/image-backfill-scheduler.test.ts \
  tests/unit/image-inline.test.ts \
  tests/unit/local-json-export.test.ts \
  tests/unit/local-markdown-export.test.ts \
  tests/smoke/current-page-capture-integrity.test.ts \
  tests/smoke/content-controller-ai-chat-autosave-backfill.test.ts \
  tests/smoke/background-router-conversations.test.ts \
  tests/smoke/backup-zip-schema.test.ts \
  tests/storage/conversations-idb.test.ts \
  tests/storage/data-revisions.test.ts \
  tests/domains/backup-service.test.ts \
  tests/domains/backup-utils.test.ts \
  tests/integration/reload-free-data-consistency.test.ts
npm run gate
npm run build:firefox
npm run check:zen
npm run check:safari
npm run cli:check
```

遵循 [真实 AI 对话验收](../../../docs/ai-chat-testing.md) 的 API-01、DOM-05：
在已登录的、获授权的**专用测试会话**完成首次/重复/续聊/重新生成/编辑/切分支/刷新/失败恢复，
通过扩展、IndexedDB、App/CLI 与导出读回确认结果；默认 DOM 不受影响。
不同浏览器按实际支持情况运行正式扩展并分别记录结果，不能拿模拟通过代替实机通过。

无法安全执行的真实分支操作、缺失的浏览器/平台、无法控制的网络故障逐项写明阻塞、
潜在影响、已有 fixture 替代证据、补验条件与是否阻塞验收。
历史接口未提供可判定的分支信息时，**宁可只走已有完整/partial-safe 流程，也不删除无证据的消息**。
