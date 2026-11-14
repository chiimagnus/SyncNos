# P1｜阶段审查

审查对象：[P1 实施计划](plan-p1.md)。
实时任务状态以 `todo.toml` 为准。

## 结论

- **结果：No-Go（无保留的真实浏览器验收）**。代码任务已完成，自动化测试、正式构建和打包均通过。
- **依据**：没有在已安装新构建扩展的专用 ChatGPT 测试会话上，完成编辑、重新生成及切换分支后的真实存储与导出读回；见 F-01。不能用模拟分页或只读服务器响应代替发布验收。

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
- 摘要：`真实 ChatGPT 分支切换、编辑与重新生成尚无新构建扩展的存储读回验收`
- 风险：`现有模拟分页和只读 API 核验不能证明真实浏览器的当前分支删除语义与后台生命周期；如与站点差异，将残留旧分支或错误清理消息`
- 预期修复：`在已授权独立 ChatGPT 测试会话与独立浏览器 Profile 运行正式构建，逐项执行编辑、重新生成、切换分支及刷新并读回 IndexedDB/导出；失败时再根因修复`
- 验证：`docs/ai-chat-testing.md API-01/IMG-01/IMG-02 的实机记录及完整 IDB/导出对照`
- 解决证据：尚未完成；需按上述真实浏览器步骤补验后再由 `finding resolve` 登记。


## 验证与未覆盖

### 已通过的自动化与构建

- macOS 27.3 / Apple Silicon；Node.js **22.22.2**：`npm run gate` exit 0，**372 个测试文件 / 3283 项测试全过**，ESLint、Prettier、TypeScript、Chromium 正式构建及包体预算检查全部通过。记录：`/tmp/syncnos-t3-v3-gate.log`。
- 同一主机 Node.js **25.9.0**：`npm run gate` exit 0，372/3283 全过，正式构建和包体检查通过。记录：`/tmp/syncnos-t3-node25-gate.log`。
- Node.js 22：`npm run build:firefox`、`npm run check:zen`（含 XPI 打包）、`npm run check:safari`、`npm run cli:check` **退出码均为 0**；对应记录 `/tmp/syncnos-t3-v3-{firefox,zen,safari,cli}.log`。
- `tests/integration/chatgpt-api-incremental-fetch.test.ts`：真实采集业务函数 + Background 路由 + `fake-indexeddb`，覆盖首次完整、续聊、无变化、编辑最后用户提问、重新生成、生成中安全暂存/完成后清理、缺失父关系的助手重叠和跨标签页消息修订竞争，核对最终本地消息键、正文、顺序、修订号与通知。
- **10,000 条真实 IndexedDB 消息** + 一轮新增：正常增量只请求 10-turn 最新页和两次 HEAD，不调用整段消息索引 `getAll`；验证旧前缀仍可随机读回。另以匿名分页夹具覆盖 1000 页/10000 个用户节点，找交界后立即停页。
- 图片调度：新增回填按消息键读取；旧持久队列未被新轻量任务覆盖，Service Worker 重启后仍可完整回退。针对这两个边界均有先失败再通过的回归。
- 使用已登录 Helium **只读** ChatGPT API：观察到 1538 个原始节点、73 个可见交互节点、最新 `current_node` 父链仅连通 4 节点、未连通到用户消息；据此补充无已知 sibling 时的有序助手重叠交界。未发送模型请求、未修改会话，也没有记录私人正文/Token。

### 尚未完成的实际验收

- **真实 ChatGPT 分支操作与 SyncNos 新构建持久化**：当前页面是私人会话，没有获得可以编辑、重新生成、切换分支并消费测试请求的专用测试会话。影响：不能确认真实站点在这些操作后的分支选择与 API 模拟完全一致，属于 **No-Go 阻塞**。补验：使用专用已授权会话，在正式扩展执行首次/重复/续聊/重生成/改写/切分支；用 IndexedDB、App/CLI 与导出核对当前分支一致且旧消息消失；详见 F-01。
- **真实浏览器安装/加载与恢复**：Helium、Zen、Safari 已安装，但没有将本次新构建安装到独立可修改的测试 Profile；Safari 也没有完成 Xcode 原生宿主的安装与操作验收。影响：无法证明真实 Content/Background/MAIN world、扩展后台重启及富图回填的浏览器端行为；自动化集成和各目标正式构建仅作替代证据。属于目标浏览器发布前 **No-Go 阻塞**。补验：在各受支持的独立测试 Profile 加载扩展并跑 `docs/ai-chat-testing.md` 的 API-01 / 图片流程。
- **未提供的其它 OS/浏览器**：macOS 未安装独立 Chrome、Edge、Firefox；Windows 工作站虽有 Edge/Node.js 24，但没有同提交的 SyncNos 测试仓库；Linux CI 及发布 Node.js 24 未在本地实际运行。影响：不能认定这些组合的真实行为已通过；替代证据为 macOS Node22/25 测试与各目标产物构建。补验：在独立已授权环境准备同提交及浏览器，通过同一门禁和真实用户流程；这些受支持环境的完整发布验收仍受限制。
- **真实故障注入**：HTTP 401/403/429/503、网络超时、故障分页、跨页重复 ID、IDB 写入中止和并发变更已由模拟及 `fake-indexeddb` 测试覆盖；没有破坏私人网络状态、修改浏览器登录令牌或主动让实际用户会话失败。影响：真实浏览器恢复仍需实测；补验是在隔离测试 Profile 控制网络并读回已保存数据，不把模拟通过列为实机通过。

文档已对应更新 `AGENTS.md`、`docs/collectors.md`、`docs/storage.md`、`docs/ai-chat-testing.md`；Feature 任务引用与 `todo.toml` 使用现有脚本验证，均在已提交的当前分支 `crth`。
