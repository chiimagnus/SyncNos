### 主要发现（要点）
- **重复的“查找或创建数据库 ID”逻辑**：`AppleBooksSyncStrategySingleDB.ensureSingleDatabaseId`、`GoodLinksSyncService.ensureGoodLinksDatabaseId`、`AppleBooksSyncStrategyPerBook.ensurePerBookDatabaseId` 都在实现同一类逻辑（从配置取，验证存在，按标题搜索，创建并保存），只是在 scope（per-source / per-book / per-all）上有差异。应统一抽出共享实现。
- **分页追加与重试切片逻辑重复/散落**：`NotionHighlightOperations.appendHighlightBullets` 包含批次切割与失败时切半重试与裁剪逻辑；`GoodLinksSyncService.appendGoodLinksHighlights` 也实现类似的批次追加（只是构造 children 的逻辑不同）。应抽成可复用的“批量追加/降级”通用方法。
- **构建 Notion block / children 的逻辑分散**：`NotionHelperMethods` 已有大量构建子块的方法（parent/children/metadata/buildHighlightChildren），但 `GoodLinksSyncService.buildContentBlocks` 与 `NotionHighlightOperations.buildHighlightChildren` 在“文本分块/分页”上存在重叠，部分通用代码可迁移到 `NotionHelperMethods`。
- **请求 URL 构建的硬编码重复**：`NotionPageOperations.replacePageChildren` 使用字面量 `https://api.notion.com/v1/` 构建 `URLComponents`（而 `NotionServiceCore.apiBase` 已定义）。建议暴露或通过 `NotionRequestHelper` 提供 URL 构造器，避免硬编码。
- **错误检查/状态判断零散**：`AppleBooksSyncStrategyPerBook.isDatabaseMissingError` 等对 Notion 错误码的判断散落，应统一放到核心层（例如 `NotionRequestHelper` 或 `NotionServiceCore` 的辅助位置）。
- **配置映射集中在 `NotionConfigStore`**：`NotionConfigStore` 已包含 `databaseIdForSource`/`setDatabaseId(_:forSource:)` 与 `databaseIdForBook`/`setDatabaseId(_:forBook:)`，这是正确位置，使用统一的 ensure/lookup helper 可以直接复用该 store 而无需在多个策略中重复写逻辑。

### 清理与合并总体目标（优先级）
1. 抽取并复用“查找或创建数据库”逻辑（高）——减少三处重复，保证行为一致。
2. 抽取“批量追加 + 切半重试 + 裁剪后跳过”通用器（高）——GoodLinks 与 Highlight 共用。
3. 将 GoodLinks 的文本分块功能移入 `NotionHelperMethods`（中）并复用。
4. 在 `NotionRequestHelper` 上增加 URL 构造/暴露方法以消除硬编码（中）。
5. 将错误码判断（是否为数据库不存在 / 被删除等）移到核心位置（低）并统一使用（便于统一处理 400/404/410）。
6. 删除/折叠显式重复注释或过时的注释（低）。

### 具体实现方案（分步骤，含建议改动文件）
- 步骤 A（添加通用 API）：在 `SyncNos/Services/0-NotionAPI/Core/` 下新增或在 `NotionService` 增加方法（推荐放在 `NotionService` 以便上层直接调用；实现委托给 `NotionDatabaseOperations` 与 `NotionConfigStore`）：
  - 建议新增方法签名（示例）：
  ```swift
  // 在 NotionService.swift 中新增
  func ensureDatabaseIdForSource(title: String, parentPageId: String, sourceKey: String) async throws -> String
  func ensurePerBookDatabaseIfMissing(bookTitle: String, author: String, assetId: String) async throws -> (id: String, recreated: Bool)
  ```
  - 用途：合并 `ensureSingleDatabaseId`、`ensureGoodLinksDatabaseId`、`ensurePerBookDatabaseId` 的公共流程（check config -> databaseExists -> findDatabaseId -> createDatabase -> save into config）。保留少量参数差异（sourceKey / per-book assetId）。

  改动文件：`SyncNos/Services/0-NotionAPI/Core/NotionService.swift`（新增 wrapper），可能调用 `NotionDatabaseOperations.findDatabaseId` 与 `NotionConfigStore`。

- 步骤 B（抽取批次追加器）：在 `SyncNos/Services/0-NotionAPI/Operations/` 下提供一个 `NotionAppendHelper`（或把方法放到 `NotionPageOperations`）用于处理：
  - 通用 append 批次大小、失败时切半重试、单条失败时裁剪并降级再试并记录日志/跳过。
  - 暴露接口示例：
  ```swift
  // 伪签名
  func appendChildrenWithRetry(pageId: String, children: [[String: Any]], batchSize: Int, trimOnFailureLengths: [Int]) async throws
  ```
  - `NotionHighlightOperations.appendHighlightBullets` 与 `GoodLinksSyncService.appendGoodLinksHighlights` 将调用此 helper（只负责构造 `children`）。

  改动文件：新增 `NotionAppendHelper.swift` 或扩展 `NotionPageOperations.swift`；修改 `NotionHighlightOperations.swift`、`GoodLinksSyncService.swift`。

- 步骤 C（合并构造 block/paragraph 函数）：
  - 将 `GoodLinksSyncService.buildContentBlocks` 移入 `NotionHelperMethods`（例如 `buildParagraphBlocks(from:)`），并提升 `NotionHelperMethods` 为真正的 stateless helper（目前已是 class，可继续）。
  - 让 `GoodLinksSyncService` 调用 `NotionHelperMethods.buildParagraphBlocks(from:)`。
  - 统一对超长文本进行 chunk 切分（chunkSize 常量集中定义）。

  改动文件：`NotionHelperMethods.swift`（新增函数）、`GoodLinksSyncService.swift`（调用替换）。

- 步骤 D（请求构造/URL 替换）：
  - 在 `NotionRequestHelper` 暴露一个小方法 `func makeURL(path: String) -> URL` 或 `func makeURLComponents(path: String) -> URLComponents`，并把 `NotionPageOperations.replacePageChildren` 中硬编码的 `https://api.notion.com/v1/` 改为通过该方法构造 URL（避免重复字面量）。
  - 这也便于未来支持 base URL 变化或 proxy。

  改动文件：`NotionRequestHelper.swift`（新增方法），`NotionPageOperations.swift`（替换构造处）。

- 步骤 E（统一错误判断）：
  - 把 `isDatabaseMissingError` 放到 `NotionRequestHelper` 或 `NotionServiceCore`（例如 `NotionServiceCore.isNotionServiceError(_:)`），并在 `AppleBooksSyncStrategyPerBook` 里替换原地实现为调用统一 helper。
  - 这能让对 400/404/410 的判断集中和可维护。

  改动文件：`NotionRequestHelper.swift` 或 `NotionServiceCore.swift`，以及 `AppleBooksSyncStrategyPerBook.swift`。

- 步骤 F（回归与清理）：
  - 运行 linter/编译，调整访问控制与注入（保留 DIContainer 注入点），删除不再使用的私有方法或注释。
  - 更新/运行任何现有单元测试（若有），或手动在模拟 NotionKey 环境下执行一次同步流程以验证边界路径（per-book、single、goodlinks）。

### 影响与注意事项
- 兼容性：这些改动是内部重构（不改变外部协议如 `NotionServiceProtocol` 应保持兼容或同步更新接口）。优先把公共行为保留并通过单元测试/手动测试验证。
- 错误语义：把错误判断集中后，可在未来统一增加重试、退避或更细粒度的错误分类（403 授权、401 无效 token 等）。
- 代码组织：建议把新 helper（Append/DB ensure）放在 `Operations` 或 `Core` 下以便于 `NotionService` 注入并复用。
- 日志：保留并统一日志点（`logger.debug` / `logger.warning`）以便在发生网络错误时能追踪失败条目（uuid）。

### 建议的最小改动清单（按文件）
- 修改（新增/扩展）：
  - `SyncNos/Services/0-NotionAPI/Core/NotionService.swift` — 新增 `ensureDatabaseIdForSource(...)` 与 `ensurePerBookDatabaseIfMissing(...)` wrapper。
  - `SyncNos/Services/0-NotionAPI/Operations/NotionPageOperations.swift` — 调用 `NotionRequestHelper.makeURL(...)` 代替硬编码 URL；考虑把 append retry helper 放这里。
  - 新增 `SyncNos/Services/0-NotionAPI/Operations/NotionAppendHelper.swift` 或把函数加入 `NotionPageOperations.swift`。
  - `SyncNos/Services/0-NotionAPI/Core/NotionRequestHelper.swift` — 增加 `makeURL(path:)` 与 `isNotionError(_:)`（或暴露 error helpers）。
  - `SyncNos/Services/0-NotionAPI/Core/NotionHelperMethods.swift` — 增加 `buildParagraphBlocks(from:)` 并保留现有方法。
  - `SyncNos/Services/0-NotionAPI/2-GoodLinksSyncToNotion/GoodLinksSyncService.swift` — 删除本地 `buildContentBlocks`，调用 `NotionHelperMethods`；把 append 调用替换为 `NotionAppendHelper`。
  - `SyncNos/Services/0-NotionAPI/1-AppleBooksSyncToNotion/AppleBooksSyncStrategySingleDB.swift` 与 `AppleBooksSyncStrategyPerBook.swift` — 替换本地 ensure DB 逻辑为调用 `NotionService.ensureDatabaseIdForSource(...)` / `ensurePerBook...`。

### 我已为你创建的 TODO（已创建、接下来的工作）
- 已添加初始 TODOs（见我刚刚写入的 TODO 列表）：
  - Audit 0-NotionAPI（正在进行）
  - Consolidate HTTP request logic
  - Merge iBooks link and metadata helpers
  - Extract batch append/retry logic
  - Unify database ID find-or-create logic
  - Refactor NotionService to use consolidated helpers

下一步我可以：按照上面优先级直接开始实现第一个重构（A：将查找/创建数据库逻辑抽到 `NotionService` 并替换调用处）。在开始修改前我会把当前 TODO 列表更新（标记审计为已完成并把“确保数据库 ID”任务设为 in_progress），然后执行并提交编辑。是否现在开始按步骤 A 实施？  

- 我会等待你的确认然后开始编辑；若你确认，我会先把 TODO 状态更新并开始实现第 A 步。  

总结要点：
- **必须合并**：查找/创建数据库 ID 的重复逻辑、批量追加/切片重试逻辑、文本分块函数。
- **建议**：新增 `ensureDatabaseIdForSource`、`NotionAppendHelper`、把 GoodLinks 的分块移动到 `NotionHelperMethods`、消除 API base 硬编码。
- 我已创建并开始跟踪 TODO，将在你确认后按优先级进行代码编辑。