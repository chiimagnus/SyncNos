# GoodLinks 自动抓取正文（列表加载后全量预取）实施计划

> 执行方式：建议使用 `executing-plans` 分批实现与验收。

**Goal（目标）:** App 打开后（GoodLinks ListView 完成加载 links），自动抓取所有“未命中持久化缓存”的 GoodLinks 文章正文，并写入 `WebArticleCacheService`；同一启动会话内失败（含无正文/异常）的 URL 不再重试。

**Non-goals（非目标）:**
- 不做“跨启动持久化失败冷却/黑名单”（仅本次启动记住失败）
- 不新增/修改本地化资源文件（`.strings` 等）
- 不改动 Notion 同步逻辑（正文抓取只是补齐缓存）

**Approach（方案）:**
- 新增一个 GoodLinks 专用的 `@ModelActor` 无关的后台服务（`actor`），负责“去重 + 会话失败记忆 + 并发调度 + 进度快照”。
- 服务内部优先用 `WebArticleCacheService.getArticle(url:)` 判定是否已缓存；未命中则调用 `WebArticleDownloadQueue.fetchArticle(url:, priority: .auto)` 触发下载并等待结果，从而能准确统计成功/失败并实现“本次会话不重试”。
- `GoodLinksViewModel.loadRecentLinks()` 成功设置 `links` 后触发一次 `enqueuePrefetch(links:)`，服务会合并多次触发并避免重复入队。
- 提供 Debug-only 进度视图（sheet），方便观察队列进度与最近事件；同时补充关键 logger 日志。

**Acceptance（验收）:**
- 打开 App 后，GoodLinks 列表加载完成会启动自动预取（可从日志与 Debug sheet 看到进度变化）。
- 对于已缓存 URL：不会触发网络抓取（统计为 cached hit / skipped）。
- 对于未缓存 URL：会进入自动抓取流程并最终写入缓存（再次打开 Detail 时能命中缓存）。
- 对于抓取失败/无正文（`fetchArticle` 返回 `nil` 或抛错）：本次启动内不会再次尝试；关闭 App 再打开会重新允许尝试。
- 任何时候手动下载正文（`.manual`）仍会插队优先于自动任务（依赖现有 `WebArticleDownloadQueueService` 行为）。

---

## Plan A（主方案）

### P1（最高优先级）：自动预取服务 + 列表加载触发

### Task 1: 定义自动预取协议与快照 DTO

**Files:**
- Modify: `SyncNos/Services/Core/Protocols.swift`
- Create: `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksAutoFetchModels.swift`

**Steps:**
1. 在 `Protocols.swift` 增加 `GoodLinksArticleAutoFetchServiceProtocol`（`Actor`），包含：
   - `enqueuePrefetch(links: [GoodLinksLinkRow]) async`
   - `snapshot() async -> GoodLinksAutoFetchSnapshot`
   - `resetSessionState() async`（仅用于 debug / 手动清理本次会话统计）
2. 新建 `GoodLinksAutoFetchModels.swift`，定义 `Sendable` DTO：
   - `GoodLinksAutoFetchSnapshot`（总数、pending、inFlight、completed、cachedHit、succeeded、failed、startedAt、lastUpdatedAt、recentEvents…）
   - `GoodLinksAutoFetchEvent`（time、url、kind、message）

**Verify:**
- Run: `xcodebuild -scheme SyncNos build`
- Expected: 编译通过（新增协议与 DTO 不引入循环依赖）

---

### Task 2: 实现 `GoodLinksArticleAutoFetchService`（会话失败不重试 + 并发）

**Files:**
- Create: `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksArticleAutoFetchService.swift`

**Steps:**
1. 实现 `actor GoodLinksArticleAutoFetchService: GoodLinksArticleAutoFetchServiceProtocol`，依赖：
   - `cacheService: WebArticleCacheServiceProtocol`
   - `downloadQueue: WebArticleDownloadQueueProtocol`
   - `logger: LoggerServiceProtocol`
2. 状态字段建议：
   - `pending: [String]`
   - `inFlight: [String: Task<Void, Never>]`
   - `attempted: Set<String>`（本次会话已处理过：cached hit / succeeded / failed 都算）
   - `failed: Set<String>`（本次会话失败/无正文）
   - 计数：`cachedHitCount / successCount / failureCount / completedCount`
   - `recentEvents: [GoodLinksAutoFetchEvent]`（上限 100，方便 Debug UI）
3. `enqueuePrefetch(links:)`：
   - 规范化 URL（trim）
   - 去重：若 `attempted.contains(url)` 或 `failed.contains(url)` 则跳过
   - 追加到 `pending`，随后 `pumpIfNeeded()`
4. `pumpIfNeeded()`：
   - 控制并发（建议默认与 `WebArticleDownloadQueueService` 一致：2）
   - 对每个 url 启动 `Task.detached(priority: .utility)` 执行 `prefetchOne(url:)`
5. `prefetchOne(url:)`：
   - 先 `cacheService.getArticle(url:)`：命中则记录 cached hit 事件并 `attempted.insert(url)`，直接完成
   - 未命中则调用 `downloadQueue.fetchArticle(url:, priority: .auto)` 等待结果
   - `result != nil` → 记录成功；`result == nil` → 记录“无正文”失败并加入 `failed`
   - catch error → 记录失败并加入 `failed`
6. 日志（logger）要求：
   - 服务启动/合并入队/完成统计（info）
   - 每条 URL 成功/无正文/失败（debug 或 info；失败用 warning/error）

**Verify:**
- Run: `xcodebuild -scheme SyncNos build`
- Expected: 编译通过；日志 tag 统一为 `[GoodLinksAutoFetch]`

---

### Task 3: 注入到 `DIContainer`

**Files:**
- Modify: `SyncNos/Services/Core/DIContainer.swift`

**Steps:**
1. 增加私有字段：`private var _goodLinksArticleAutoFetchService: GoodLinksArticleAutoFetchServiceProtocol?`
2. 增加计算属性：`var goodLinksArticleAutoFetchService: GoodLinksArticleAutoFetchServiceProtocol { ... }`
3. 初始化时注入现有依赖：`webArticleCacheService`、`webArticleDownloadQueue`、`loggerService`

**Verify:**
- Run: `xcodebuild -scheme SyncNos build`
- Expected: 编译通过；DIContainer 不产生初始化循环

---

### Task 4: 在 GoodLinks 列表加载完成后触发自动预取

**Files:**
- Modify: `SyncNos/ViewModels/GoodLinks/GoodLinksViewModel.swift`

**Steps:**
1. 在 `loadRecentLinks(limit:)` 成功设置 `self.links = rows` 后，启动后台触发：
   - `let links = rows`（避免捕获 self）
   - `Task.detached(priority: .utility) { await DIContainer.shared.goodLinksArticleAutoFetchService.enqueuePrefetch(links: links) }`
2. 避免与 UI 逻辑耦合：不更新 `@Published`，仅触发服务。
3. 为避免重复触发噪音：服务内部负责去重与合并（此处不做额外判断）。

**Verify:**
- Run: `xcodebuild -scheme SyncNos build`
- Manual: 打开 App，观察控制台出现 `[GoodLinksAutoFetch]` 启动/进度日志

---

### P2：Debug 进度视图（方便观察与调试）

### Task 5: 添加 Debug sheet（查看自动预取进度）

**Files:**
- Modify: `SyncNos/Views/Settings/SyncFrom/GoodLinksSettingsView.swift`
- Create: `SyncNos/Views/Settings/SyncFrom/GoodLinksAutoFetchDebugView.swift`

**Steps:**
1. 在 `GoodLinksSettingsView` 增加 `#if DEBUG` Section：
   - Button：打开 sheet（类似 `OCRSettingsView` 的 debug sheet 方式）
2. 新增 `GoodLinksAutoFetchDebugView`（sheet）：
   - 展示 `GoodLinksAutoFetchSnapshot`：total / pending / inFlight / completed / cachedHit / succeeded / failed
   - 展示最近事件列表（recentEvents，倒序）
   - 提供 Debug-only 操作按钮：
     - `Reset Session State` → 调用 `resetSessionState()`
     - `Trigger Prefetch Now`（可选）→ 让开发者手动触发一次（若需要，可调用 GoodLinksViewModel 的 `loadRecentLinks` 后再入队；或仅复用服务的 `enqueuePrefetch`，由调用方传入 links）
3. 刷新机制：
   - 用 `Timer.publish(every: 0.5, ...)` 或 `Task.sleep` 循环轮询 `snapshot()` 并更新 UI（sheet 存在时刷新即可）
4. 字体规范：所有文本使用 `.scaledFont(...)`（跟随项目动态字体规则）。

**Verify:**
- Run: `xcodebuild -scheme SyncNos build`
- Manual: 打开 Settings → GoodLinks → Debug Sheet，确认计数与事件随自动预取变化

---

## 回归验证（完成 P1+P2 后）

- Build: `xcodebuild -scheme SyncNos build`
- Manual checklist:
  - 打开 App 后等待 GoodLinks links 加载，Debug sheet 看到 pending 逐步下降、completed 上升
  - 在 Detail 中手动点击“下载正文”，确认 `.manual` 任务仍可插队（观察日志顺序）
  - 刷新/重载 GoodLinks 列表（触发 `loadRecentLinks`）后：本次会话失败 URL 不会再次进入自动预取

---

## 不确定项（实现时如遇到再确认）

- “无正文”（`fetchArticle` 返回 `nil`）是否算失败：本计划按“本次会话不再重试”处理（与选项 B 一致）。
- 自动预取并发度：默认 2；若实际 links 数量巨大导致完成时间过长，可再讨论是否做“分批/只预取前 N”或提供开关。

