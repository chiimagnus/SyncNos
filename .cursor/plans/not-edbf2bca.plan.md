<!-- edbf2bca-046e-402b-bdc1-25637616db17 06896d57-0999-49ab-9472-f477155ab9f3 -->
# 将“上次同步时间”迁移到 Notion 字段的实施计划

#### 目标

- 在 Notion 为每本书/每个链接维护 `Last Sync Time`（date），作为单一事实来源。
- 移除本地 `UserDefaults` 持久化逻辑，按需从 Notion 读取并在同步完成后回写。
- UI 排序与展示改为基于 ViewModel 的缓存（由 Notion 预取填充），遵循 MVVM。

#### 影响范围（关键文件）

- Notion 架构与操作：
  - `SyncNos/Services/0-NotionAPI/Operations/NotionDatabaseOperations.swift`
  - `SyncNos/Services/0-NotionAPI/Operations/NotionPageOperations.swift`
  - `SyncNos/Services/0-NotionAPI/Core/NotionService.swift`
- 时间戳存储协议与实现：
  - `SyncNos/Services/Infrastructure/Protocols.swift`
  - 新增：`SyncNos/Services/Infrastructure/NotionTimestampStore.swift`
  - 删除/替换：`SyncNos/Services/0-NotionAPI/1-AppleBooksSyncToNotion/SyncTimestampStore.swift`
  - `SyncNos/Services/Infrastructure/DIContainer.swift`
- 同步策略/服务：
  - `SyncNos/Services/0-NotionAPI/1-AppleBooksSyncToNotion/AppleBooksSyncStrategySingleDB.swift`
  - `SyncNos/Services/0-NotionAPI/1-AppleBooksSyncToNotion/AppleBooksSyncStrategyPerBook.swift`
  - `SyncNos/Services/0-NotionAPI/2-GoodLinksSyncToNotion/GoodLinksSyncService.swift`
  - `SyncNos/Services/Infrastructure/AutoSyncService.swift`
- ViewModel 与 View：
  - `SyncNos/ViewModels/BookViewModel.swift`
  - `SyncNos/ViewModels/GoodLinksViewModel.swift`
  - `SyncNos/Views/AppleBooks/AppleBooksListView.swift`
  - `SyncNos/Views/GoodLinks/GoodLinksListView.swift`

---

### 步骤一：扩展/确保 Notion Schema，加入 Last Sync Time

- 在创建数据库时增加属性：
  - AppleBooks 单库（书籍聚合库）与 GoodLinks 单库：在 `createDatabase(...)` 的 `properties` 中加入：
    ```swift
    "Last Sync Time": ["date": [:]]
    ```

  - AppleBooks 每书独立库：在 `createPerBookHighlightDatabase(...)` 的 `properties` 中加入同名属性。
- 对已经存在的数据库：在首次使用处调用 `ensureDatabaseProperties(databaseId:definitions:)` 以幂等补齐字段：
  - AppleBooks 单库策略 `sync/syncSmart` 入口处调用一次。
  - GoodLinks 同步服务在已调用的 `ensureDatabaseProperties(...)` 字典中并入 `Last Sync Time`。
- AppleBooks 每书独立库没有“书籍页面”，需在该库内维护一条 `Meta` 页面（以 `UUID == "SYNC_META"` 唯一标识）来读写 `Last Sync Time`。

### 步骤二：新增 NotionTimestampStore（替换本地存储）

- 协议（破坏性更新），位于 `Protocols.swift`：
  ```swift
  protocol SyncTimestampStoreProtocol: AnyObject {
      func getLastSyncTime(for id: String, source: String) async -> Date?
      func setLastSyncTime(for id: String, source: String, to date: Date) async throws
      func prefetch(for ids: [String], source: String) async
      func cachedLastSync(for id: String) -> Date?
  }
  ```

- 实现类：`Services/Infrastructure/NotionTimestampStore.swift`
  - 依赖 `NotionServiceProtocol`、`NotionConfigStoreProtocol`、`LoggerServiceProtocol`。
  - source 取值：`"appleBooks" | "goodLinks"`。
  - AppleBooks 单库/GoodLinks：通过 `ensureDatabaseIdForSource(...)` + `findPageIdByAssetId(...)` → `Last Sync Time` 读/写。
  - AppleBooks 每书独立库：通过 `databaseIdForBook(assetId:)` + `findHighlightItemPageIdByUUID(dbId, "SYNC_META")`（无则创建一条 `Meta` 页）进行读/写。
  - 统一维护内存缓存 `lastSyncCache: [String: Date]`，`prefetch` 批量填充，所有写入成功后更新缓存。
- `DIContainer.syncTimestampStore` 指向新的实现；删除旧 `SyncTimestampStore.shared` 静态引用。

### 步骤三：改造同步策略/服务使用 Notion 时间戳

- AppleBooks 单库策略 `AppleBooksSyncStrategySingleDB`：
  - since 获取：`let since = incremental ? await timestampStore.getLastSyncTime(for: book.bookId, source: "appleBooks") : nil`
  - 完成后回写：`try await timestampStore.setLastSyncTime(for: book.bookId, source: "appleBooks", to: Date())`
  - 首次进入策略时调用一次 `ensureDatabaseProperties(..., ["Last Sync Time": ["date": [:]]])`。
- AppleBooks 每书独立库 `AppleBooksSyncStrategyPerBook`：相同读写逻辑；读写定位改为该书的 per-book DB + Meta 页。
- GoodLinks 同步服务 `GoodLinksSyncService`：完成后回写 `goodLinks` 源的时间戳；在入口调用 `ensureDatabaseProperties`。

### 步骤四：AutoSync 预取 + 过滤

- `AutoSyncService.triggerSyncNow()` → `syncAllBooksSmart(...)`：
  - 在 24 小时过滤前：`await timestampStore.prefetch(for: assetIds, source: "appleBooks")`。
  - 过滤时使用缓存：
    ```swift
    if let last = timestampStore.cachedLastSync(for: id), now.timeIntervalSince(last) < intervalSeconds { ... }
    ```


### 步骤五：ViewModel 缓存与排序改造（MVVM）

- `BookViewModel`、`GoodLinksViewModel`：
  - 新增 `@Published var lastSyncById: [String: Date] = [:]`。
  - 在 `loadBooks()` / `loadRecentLinks()` 结束后调用 `await timestampStore.prefetch(...)` 并将缓存拷贝到 `lastSyncById`，触发排序刷新。
  - 排序逻辑改为从 `lastSyncById[...] ?? .distantPast` 获取时间。
- 视图展示（上下文菜单“Last Sync”）改为从 ViewModel 的 `lastSyncById` 读取，移除对存储层的直接访问。

### 步骤六：清理与移除

- 删除 `SyncNos/Services/0-NotionAPI/1-AppleBooksSyncToNotion/SyncTimestampStore.swift` 与所有 `SyncTimestampStore.shared` 调用点。
- 更新 `DIContainer` 构造/注册，移除对旧实现的依赖与注释。

### 步骤七：边界处理与一致性

- 缺失字段/页面：读时返回 `nil`（触发全量或本地逻辑），并在后续同步完成后写回时间戳。
- 时间格式：统一使用 `ISO8601DateFormatter`，只写 `date.start`。
- 速率与重试：沿用现有 `NotionRateLimiter` 与 429 重试策略。

### 步骤八（可选）：一次性回填迁移

- 启动后读取本地 `LAST_SYNC_TIMESTAMP_*`，尝试写回到 Notion 对应页/Meta 页，然后清除本地键。若不需要历史保留，可跳过。

### 步骤九：文档/文案更新

- 在 `UserGuideView` 与 `Resource/*` 文档中说明：
  - “上次同步时间”现由 Notion 字段维护；跨设备一致；本地不再持久化。

### To-dos

- [ ] 为三类数据库新增并确保 Last Sync Time 属性
- [ ] 实现 NotionTimestampStore 并更新协议为 async 接口
- [ ] 更新 DIContainer 注入新的存储实现，移除旧单例
- [ ] 改造 AppleBooks 两种策略使用 Notion 时间戳
- [ ] 改造 GoodLinks 同步回写 Last Sync Time
- [ ] AutoSync 批量预取并基于缓存过滤 24 小时内项
- [ ] 在两类 ViewModel 预取缓存并改造排序
- [ ] 视图展示从 ViewModel 的 lastSyncById 读取
- [ ] 删除旧 SyncTimestampStore 与所有引用
- [ ] 更新用户文档与界面文案说明迁移变化