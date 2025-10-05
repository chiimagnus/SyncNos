### 背景与目标
Apple Books 同步目前以 `NotionAPI/Sync` 目录为中心（`NotionSyncCoordinator` + 多个 `SyncStrategy*`），直接在 Notion 层内承载了 Apple Books 的领域逻辑；而 GoodLinks 同步采用了清晰的“领域服务（GoodLinksSyncService）+ Notion 抽象（NotionServiceProtocol）”的分层结构。两者架构不一致，导致 Apple Books 同步与 Notion API 存在显著耦合。

本方案的目标：
- 将 Apple Books 同步从 Notion 层迁出，重构为与 GoodLinks 一致的“领域服务 + 策略”模式。
- 明确边界：Notion 层只提供通用 API 能力；Apple Books 层聚合业务流程与策略；UI 层仅依赖领域服务接口。
- 采用协议与依赖注入，保持可测试、可扩展与清晰的数据流。
- 在不追求旧版本系统兼容的前提下，面向 macOS 13+，使用 Swift 6.1/SwiftUI 最佳实践。

---

### 现状审计（已逐文件确认）
- Apple Books 同步入口/流程：
  - `SyncNos/Services/NotionAPI/Sync/NotionSyncCoordinator.swift`
  - `SyncNos/Services/NotionAPI/Sync/SyncStrategySingleDB.swift`
  - `SyncNos/Services/NotionAPI/Sync/SyncStrategyPerBook.swift`
  - `SyncNos/Services/NotionAPI/Sync/SyncTimestampStore.swift`（时间戳存储，供增量同步）
- UI/调度：
  - `SyncNos/ViewModels/AppleBookDetailViewModel.swift` 直接依赖 `NotionSyncCoordinatorProtocol`
  - `SyncNos/Services/Infrastructure/AutoSyncService.swift` 直接依赖 `NotionSyncCoordinator`
- Apple Books 数据访问：
  - `SyncNos/Services/AppleBooks/DatabaseService.swift`
  - `SyncNos/Services/AppleBooks/DatabaseReadOnlySession.swift`
  - `SyncNos/Services/AppleBooks/DatabaseConnectionService.swift`
  - `SyncNos/Services/AppleBooks/DatabaseQueryService.swift`
- Notion 抽象：
  - `SyncNos/Services/NotionAPI/Core/NotionService.swift` + `Operations/*`
  - `SyncNos/Services/Infrastructure/Protocols.swift` 中的 `NotionServiceProtocol`

---

### 问题分析（耦合带来的风险）
- **分层不清**：Apple Books 的业务流程位于 `NotionAPI/Sync` 下，导致 Notion 层对业务细节“有感知”。
- **可测试性下降**：UI/调度直接依赖 `NotionSyncCoordinator`，难以在 Apple Books 层替换策略、mock 能力。
- **与 GoodLinks 架构不一致**：维护成本高、心智负担重，难以共享最佳实践（如 GoodLinks 的解耦模式）。
- **演进阻力**：未来若新增同步目标（如本地 Markdown、Notion 可替换为其他目的地），现结构扩展困难。

---

### 目标架构（与 GoodLinks 对齐）
- **AppleBooks 层**（领域）：
  - `AppleBooksSyncServiceProtocol`：对 UI/调度暴露统一接口。
  - `AppleBooksSyncService`：Facade/UseCase 聚合；按配置选择策略；编排流程与进度回调。
  - `AppleBooksSyncStrategyProtocol` + 实现：
    - `AppleBooksSyncStrategySingleDB`（单库每书一页）
    - `AppleBooksSyncStrategyPerBook`（每书一个 Notion 数据库）
  - 可选的 `SyncTimestampStore`（迁至更合适位置，如 `Infrastructure/Sync/`）。
- **Notion 层**（基础能力）：
  - 保持 `NotionServiceProtocol` 的通用 API 能力（`appendBlocks`/`updatePageProperties` 等）。
  - 领域特定（book/highlight）辅助 API 继续存在，但仅作为“可选实现细节”，不承载业务流程。
- **UI/调度层**：
  - `AppleBookDetailViewModel` 与 `AutoSyncService` 不再依赖 `NotionSyncCoordinator`，统一依赖 `AppleBooksSyncServiceProtocol`。
- **DI 容器**：
  - 新增 `appleBooksSyncService` 的注册与获取；保留 GoodLinks 的一致性。

架构对比：
- 之前：UI/AutoSync -> NotionSyncCoordinator(位于 Notion 层) -> 策略 -> NotionService。
- 之后：UI/AutoSync -> AppleBooksSyncService(位于 AppleBooks 领域层) -> AppleBooks 策略 -> NotionService。

---

### 接口设计（对外/对内）
- 对 UI/调度暴露：
```swift
public protocol AppleBooksSyncServiceProtocol: AnyObject {
    func syncSmart(book: BookListItem, dbPath: String?, progress: @escaping (String) -> Void) async throws
    func sync(book: BookListItem, dbPath: String?, incremental: Bool, progress: @escaping (String) -> Void) async throws
}
```

- 服务实现（要点）：
```swift
public final class AppleBooksSyncService: AppleBooksSyncServiceProtocol {
    private let databaseService: DatabaseServiceProtocol
    private let notionService: NotionServiceProtocol
    private let config: NotionConfigStoreProtocol

    // 策略工厂：基于 config.syncMode 返回 SingleDB 或 PerBook 策略
    private func makeStrategy() -> AppleBooksSyncStrategyProtocol { /* ... */ }

    public init(
        databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
        notionService: NotionServiceProtocol = DIContainer.shared.notionService,
        config: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore
    ) {
        self.databaseService = databaseService
        self.notionService = notionService
        self.config = config
    }

    public func syncSmart(book: BookListItem, dbPath: String?, progress: @escaping (String) -> Void) async throws {
        try await makeStrategy().syncSmart(book: book, dbPath: dbPath, progress: progress)
    }

    public func sync(book: BookListItem, dbPath: String?, incremental: Bool, progress: @escaping (String) -> Void) async throws {
        try await makeStrategy().sync(book: book, dbPath: dbPath, incremental: incremental, progress: progress)
    }
}
```

- 策略协议：
```swift
protocol AppleBooksSyncStrategyProtocol {
    func sync(book: BookListItem, dbPath: String?, incremental: Bool, progress: @escaping (String) -> Void) async throws
    func syncSmart(book: BookListItem, dbPath: String?, progress: @escaping (String) -> Void) async throws
}
```

- 两个策略实现将直接迁移自现有 `SyncStrategySingleDB` / `SyncStrategyPerBook`，仅改名与命名空间调整，保持核心算法不变；Notion 交互仍通过 `NotionServiceProtocol`，数据读取仍依赖 `DatabaseServiceProtocol`。

---

### 迁移步骤（破坏式更改，明确落地顺序）
1) 新增目录与文件（Apple Books 领域层）：
- 新建：`SyncNos/Services/AppleBooks/Sync/`
  - `AppleBooksSyncServiceProtocol.swift`
  - `AppleBooksSyncService.swift`
  - `AppleBooksSyncStrategyProtocol.swift`
  - `AppleBooksSyncStrategySingleDB.swift`
  - `AppleBooksSyncStrategyPerBook.swift`
  - 将 `SyncTimestampStore.swift` 从 `NotionAPI/Sync/` 迁至 `Infrastructure/Sync/` 或 `AppleBooks/Sync/`（建议 `Infrastructure/Sync/` 便于多源复用）。

2) 文件迁移与重命名：
- 移动并重命名：
  - `NotionAPI/Sync/SyncStrategySingleDB.swift` → `AppleBooks/Sync/AppleBooksSyncStrategySingleDB.swift`
  - `NotionAPI/Sync/SyncStrategyPerBook.swift` → `AppleBooks/Sync/AppleBooksSyncStrategyPerBook.swift`
- 删除/下线：
  - `NotionAPI/Sync/NotionSyncCoordinator.swift`（由 `AppleBooksSyncService` 取代）。

3) DI 容器：
- 在 `DIContainer` 中新增：
```swift
private var _appleBooksSyncService: AppleBooksSyncServiceProtocol?
var appleBooksSyncService: AppleBooksSyncServiceProtocol {
    if _appleBooksSyncService == nil { _appleBooksSyncService = AppleBooksSyncService() }
    return _appleBooksSyncService!
}
func register(appleBooksSyncService: AppleBooksSyncServiceProtocol) { self._appleBooksSyncService = appleBooksSyncService }
```
- 移除/废弃 `syncCoordinator` 的对外暴露与注入路径（统一在 Apple Books 层消费策略）。

4) UI/调度改造：
- `AppleBookDetailViewModel` 构造函数与调用点：
  - 用 `AppleBooksSyncServiceProtocol` 替代 `NotionSyncCoordinatorProtocol`。
  - `syncSmart`/`syncToNotion` 内部改为调用 `appleBooksSyncService`。
- `AutoSyncService`：
  - `syncAllBooksSmart`、降级增量同步等路径均改为调用 `appleBooksSyncService`。

5) Notion 层清理：
- `NotionAPI/Sync` 目录删除。
- `NotionServiceProtocol` 保留通用 API。若未来希望与 GoodLinks 完全一致，可将 Apple Books 当前使用的书籍/高亮专用方法（如 `appendHighlightBullets` 等）逐步替换为通用 `appendBlocks` + 由 AppleBooks 层构建的 blocks（本次不强制，避免过度改动）。

6) 配置与数据存储：
- 继续使用 `NotionConfigStore` 的 per-source `databaseIdForSource("appleBooks")` 机制。
- 时间戳 `SyncTimestampStore` 迁至通用位置，避免与 Notion 目录绑定。

---

### 行为不变性与性能考量
- 保持现有策略逻辑与批量参数：
  - `SingleDB`：继续按页读取，新增去重/增量更新逻辑不变。
  - `PerBook`：保持“每高亮一页”的模型与重建数据库的兜底逻辑。
- 网络批量：维持既有批大小（如 50/100），保留后续从设置注入能力。
- 错误与回退：保留“数据库缺失 → 自动重建 → 重试”的路径。

---

### 示例调用流（完成后的整体流程）
- UI：`AppleBookDetailViewModel.syncSmart(book:dbPath:)`
  - 依赖注入 `appleBooksSyncService`
  - `AppleBooksSyncService.makeStrategy()` 选择策略
  - 策略读取本地 DB（`DatabaseServiceProtocol`）
  - 通过 `NotionServiceProtocol` 与 Notion 交互（查找/创建数据库与页面、追加 blocks/更新属性）
  - 使用 `SyncTimestampStore` 记录增量边界

---

### 风险 & 回滚方案
- 破坏式变更点：
  - 移除 `NotionSyncCoordinator` 的对外使用；UI/调度改为依赖新的服务协议。
  - `DIContainer` API 变化（新增 `appleBooksSyncService`，移除 `syncCoordinator`）。
- 回滚：
  - 保留 `refactor_Notion` 分支；重构提交为单独 PR；如需回滚，revert 该 PR 即可恢复 `NotionSyncCoordinator` 路径。

---

### 测试方案（必须）
- 单元测试：
  - 为 `AppleBooksSyncService` 与两种策略编写单测，使用 `NotionServiceProtocol`/`DatabaseServiceProtocol` 的 mock 实现。
  - 覆盖：全量/增量同步、数据库缺失重建、异常路径、批量边界（0、1、N）、1K+ 高亮性能冒烟。
- 集成测试：
  - 使用本地测试 SQLite 样本，断言最终 blocks/属性更新数量与内容。
  - 在沙盒/测试 Notion 工作区下运行端到端（可配置 API Key/Page）。
- 回归测试：
  - GoodLinks 同步端到端测试，确保不受影响（同一 NotionServiceProtocol）。

---

### 任务清单（落地执行顺序）
1. 创建 `AppleBooks/Sync` 目录与四个核心文件（协议、服务、两策略）。
2. 迁移并重命名 `SyncStrategySingleDB/PerBook` 至新目录，命名替换为 `AppleBooks*` 前缀；修正命名空间与导入。
3. 迁移 `SyncTimestampStore` 至 `Infrastructure/Sync/`；统一对外静态访问入口。
4. 增加 `DIContainer.appleBooksSyncService`，提供注册与默认实现。
5. 改造 `AppleBookDetailViewModel` 与 `AutoSyncService`：替换为调用 `appleBooksSyncService`。
6. 删除 `NotionAPI/Sync` 目录与旧引用；全局搜索替换并编译通过。
7. 运行单元测试与端到端集成测试；修复问题并提交 PR。

---

### 验收标准
- UI/调度层不再引用 `NotionSyncCoordinator*`；仅依赖 `AppleBooksSyncServiceProtocol`。
- Notion 层不再持有 Apple Books 领域流程代码；仅保留通用/可选的领域辅助方法。
- 与重构前行为一致（相同数据、相同计数/增量效果），性能不下降。
- 完整通过单元测试与集成测试。

---

### 后续演进（可选）
- 统一 GoodLinks/AppleBooks 的 blocks 构建器，沉淀为通用的 `RichTextBlocksBuilder`，减少重复。
- 将批量大小/并发度等参数暴露为设置，按需调优。
- 引入结构化日志与可观测性（埋点/追踪 sync session id）。

---

### 结论
本方案将 Apple Books 同步彻底从 Notion 层抽离，统一为与 GoodLinks 一致的“领域服务 + 策略 + DI”结构。变更清晰、可回滚、可测试，并保留现有性能特征。按上述步骤实施，可在较低风险下完成结构性治理，奠定后续跨来源同步能力统一化的基础。
