# GoodLinks 自动 Fetch（正文预取缓存）实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。  
> 本文阶段只写计划，不改代码。

**Goal（目标）:** 独立于 Notion 同步，新增一个 GoodLinks “自动预取正文并落入本地缓存（SwiftData）”的后台任务：持续扫描所有 GoodLinks links，缓存缺失则抓取；抓取失败仅本轮跳过，下一轮继续尝试，直到大多数内容完成缓存。

**Non-goals（非目标）:**
- 不改 Notion 同步链路与策略（`GoodLinksNotionAdapter` 仍按现有逻辑工作）
- 不做“失败持久化黑名单”（失败不写入持久化状态，下一轮仍会再尝试）
- 不提供用户开关：Auto Fetch **强制开启**（不允许用户关闭）
- 不新增自动化测试套件（当前仓库无 XCTest 目标；本计划以 `xcodebuild` 构建验证为主）

**Approach（方案）:**
- 复用现有 `WebArticleFetcher.fetchArticle(url:)`（内部已含“读缓存→抓取→写缓存”）。
- 增加一个独立的 `AutoFetchService`（timer + 事件触发），以及 `GoodLinksAutoFetchProvider` 负责“扫描 DB → 找到未缓存项 → 逐个抓取”。
- **抓取顺序**必须与用户 GoodLinks ListView 的显示顺序一致：按用户当前的排序配置，从上到下依次抓取（只做排序，不做过滤）。
- **启用条件**：仅当 GoodLinks 数据源已启用（`datasource.goodLinks.enabled == true`）时才运行 Auto Fetch；否则必须 no-op。

**Acceptance（验收）:**
- Auto Fetch 无需用户操作，应用启动后会自动开始工作并持续跑；不会提供关闭入口。
- 当 `datasource.goodLinks.enabled == false` 时，Auto Fetch 不运行（无网络抓取、无写缓存行为）。
- 对任意一个未缓存 URL：最终会出现在 `WebArticleCacheService` 中（命中 `getArticle(url:)`）。
- 对抓取失败 URL：本轮扫描会跳过并继续下一个；下一轮会再次尝试（无需手动操作）。
- 构建通过：`xcodebuild -scheme SyncNos build`

---

## Plan A（主方案）

### P1：服务与调度（最小可用）

### Task 1：新增 AutoFetch 协议与服务入口

**Files:**
- Create: `SyncNos/Services/SyncScheduling/AutoFetchSourceProvider.swift`
- Modify: `SyncNos/Services/Core/Protocols.swift`
- Modify: `SyncNos/Services/Core/DIContainer.swift`

**Steps:**
1. 在 `SyncNos/Services/SyncScheduling/AutoFetchSourceProvider.swift` 定义 `AutoFetchSourceProvider`（接口风格对齐 `AutoSyncSourceProvider`）。
2. 在 `SyncNos/Services/Core/Protocols.swift` 新增 `AutoFetchServiceProtocol`（至少：`start()`, `stop()`, `isRunning`, 可选 `triggerFetchNow()` / per-source triggers）。
3. 在 `SyncNos/Services/Core/DIContainer.swift` 注册 `autoFetchService`（lazy init），与 autoSync 并列，互相独立。

**Verify:**
- Run: `xcodebuild -scheme SyncNos build`

---

### Task 2：实现 AutoFetchService（定时 + 事件触发）

**Files:**
- Create: `SyncNos/Services/SyncScheduling/AutoFetchService.swift`
- Modify: `SyncNos/Models/Core/NotificationNames.swift`（如需新增通知）

**Design notes:**
- 触发来源建议与 GoodLinks 授权一致：监听 `.goodLinksFolderSelected` 后触发一次 fetch（可选）。
- 定时策略：默认每 5 分钟触发一次“扫描并推进一轮”（与 AutoSync 类似但独立）。
- Service 本身不做具体抓取逻辑，只负责调用 provider。

**Suggested Swift sketch:**
```swift
final class AutoFetchService: AutoFetchServiceProtocol {
    private let providers: [ContentSource: AutoFetchSourceProvider]
    private var timerCancellable: AnyCancellable?
    private var notificationCancellable: AnyCancellable?

    func start() { /* set up timer + notifications */ }
    func stop() { /* cancel */ }
    func triggerFetchNow() { providers.values.forEach { $0.triggerScheduledFetchIfEnabled() } }
}
```

**Verify:**
- Run: `xcodebuild -scheme SyncNos build`

---

### P2：GoodLinks Provider（核心抓取循环）

### Task 3：抽取 GoodLinks ListView 排序/筛选逻辑为可复用组件

**Why:**
- 需求要求“Auto Fetch 必须按用户 ListView 的顺序从上到下抓取”。目前排序/筛选逻辑位于 `GoodLinksViewModel` 的私有实现中，Service 层不可直接复用。

**Files:**
- Create: `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksListOrderBuilder.swift`（或放在 `SyncNos/Models/GoodLinks/`，以项目实际分层为准）
- Modify: `SyncNos/ViewModels/GoodLinks/GoodLinksViewModel.swift`（改为调用新组件）
- Modify: `SyncNos/Services/SyncScheduling/GoodLinksAutoFetchProvider.swift`（改为调用新组件）

**Behavior:**
- 输入：`[GoodLinksLinkRow]` + 用户偏好（`sortKey`, `sortAscending`）
- 输出：按 ListView 显示顺序排序后的 `[GoodLinksLinkRow]`（仅排序，不做任何过滤）

**Verify:**
- Run: `xcodebuild -scheme SyncNos build`

---

### Task 4：实现 GoodLinksAutoFetchProvider（按 ListView 顺序扫描未缓存项并抓取）

**Files:**
- Create: `SyncNos/Services/SyncScheduling/GoodLinksAutoFetchProvider.swift`
- Modify: `SyncNos/Services/SyncScheduling/AutoFetchService.swift`（把 provider 注入进去）

**Behavior:**
- Auto Fetch 强制开启：provider **不**读取 `UserDefaults` 开关；只做“条件满足则运行”的安全检查（例如 DB 存在且可打开）。
- 仅当 `UserDefaults.standard.bool(forKey: "datasource.goodLinks.enabled") == true` 才允许运行；否则直接返回。
- 读取 GoodLinks DB：`resolveDatabasePath()` + `makeReadOnlySession` + `fetchRecentLinks(limit: 0)`
- 对 links 先应用 ListView 顺序（Task 3 的 builder），再从上到下处理每个 link：
  - 先 `try await cacheService.getArticle(url: link.url)`；命中则跳过
  - 未命中则 `try await urlFetcher.fetchArticle(url: link.url)`（成功自动写缓存）
  - 任意错误：记录日志并“本轮跳过”，继续下一个
- 并发与节流：
  - 单线程顺序抓取（建议），避免抢占 UI；任务使用 `.utility` 或 `.background`
  - 每次抓取后可 `sleep` 200–500ms 作为节流（可配置常量）
- 防重入：provider 内部用 `isFetching` 防止并行多次扫描。

**Suggested Swift sketch:**
```swift
final class GoodLinksAutoFetchProvider: AutoFetchSourceProvider {
    let id: ContentSource = .goodLinks

    private var isFetching = false

    func triggerScheduledFetchIfEnabled() { runIfNeeded() }
    func triggerManualFetchNow() { runIfNeeded() }
}
```

**Verify:**
- Run: `xcodebuild -scheme SyncNos build`
- Manual: 开启开关后观察日志：应出现“cache hit / fetched / skipped(error)”等进度输出

---

### P3：App 启动接线（无用户开关）

### Task 5：应用启动时自动启动 AutoFetchService

**Files:**
- Modify: `SyncNos/SyncNosApp.swift`

**Behavior:**
- 在 `init()` 中直接 `DIContainer.shared.autoFetchService.start()`
- 注意：不要依赖 Notion 配置状态；也不要与 autoSyncEnabled 绑定
  - 但 provider 必须尊重 `datasource.goodLinks.enabled`（未启用则 no-op）

**Verify:**
- Run: `xcodebuild -scheme SyncNos build`

---

## Plan B（备选/增强项）

### B1：减少全量扫描开销（可选）
- 在 `WebArticleCacheServiceProtocol` 增加 `listCachedURLs()` 或 `contains(url:)`，减少对 SwiftData 的逐条 fetch。
- 在 GoodLinks SQLite 查询层新增分页接口（limit/offset），避免一次性把所有 links 拉进内存。

### B2：UI 可视化进度（可选）
- 进度展示放在 `SyncNos/Views/GoodLinks/GoodLinksListView.swift` 顶部（你偏好的位置），做成轻量状态条：`ProgressView` + 计数文本（尽量只展示数字/图标，避免动 i18n 资源文件）。
- 通过 `NotificationCenter` 增加 `.autoFetchStatusChanged`（或更具体的 `.autoFetchProgressUpdated`）通知，携带：`processed`, `cachedHit`, `fetched`, `skipped`, `total`。
- `GoodLinksViewModel` 订阅并维护 `@Published` 进度状态，驱动 ListView 顶部状态条；当 `processed == total` 时自动隐藏/显示“已完成”。

---

## 不确定项（执行前确认）
- 是否需要“仅在应用前台/空闲时运行”的策略？（默认建议：先不做复杂的空闲检测，P2 再优化）
