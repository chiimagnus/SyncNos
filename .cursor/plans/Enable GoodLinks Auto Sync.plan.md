<!-- 1e251bb0-dbf5-4b4b-a0b5-7c04d0c275d8 5f1bf152-d668-436c-8ea8-1956552b6d62 -->
# Enable GoodLinks Auto Sync

目标：在现有的 AutoSyncService 中增添 GoodLinks 的自动同步能力，使应用在启用全局 Auto Sync 时同时对 Apple Books 和 GoodLinks 进行增量同步并将高亮推送到 Notion。实现应遵循现有 Apple Books 自动同步设计（同样使用通知触发、定时器、并发 task group、SyncTimestampStore 节流）。

主要修改点（按文件）：

- `SyncNos/Services/Infrastructure/AutoSyncService.swift`
- 添加对 GoodLinks 数据目录的检测（利用 `GoodLinksBookmarkStore.shared.restore()`），并在 `start()` 中监听 `Notification.Name("GoodLinksFolderSelected")` 与可选的 `Notification.Name("RefreshGoodLinksRequested")`。
- 在 `triggerSyncNow()` 中增加条件与路径检查，分别决定是否执行 Apple Books 同步与 GoodLinks 同步。
- 新增私有方法 `syncAllGoodLinksSmart(dbPath: String)`：与 `syncAllBooksSmart(...)` 对称实现，枚举所有 link id（或 recent links），基于 `SyncTimestampStore` 筛选需同步的链接，使用 bounded concurrency（与 books 相同的 max 并发数）调用 `GoodLinksSyncService.syncHighlights(for:dbPath:pageSize:progress:)` 并发送相应的通知（`SyncBookStarted`/`SyncBookFinished` 改为 `SyncLinkStarted`/`SyncLinkFinished` 或复用现有通知名并在 userInfo 中区分 source）。

- `SyncNos/Services/0-NotionAPI/2-GoodLinksSyncToNotion/GoodLinksSyncService.swift`
- （一般无需改动）确保 `syncHighlights(for:dbPath:pageSize:progress:)` 的行为为幂等、可重入且仅追加新条目或跳过已同步内容；若需要，添加对 `created`/`updated` 时间判断或返回已同步的 assetId 列表以便 timestamp 更新。

- `SyncNos/Services/2-GoodLinks/GoodLinksService.swift`
- （一般无需改动）确保提供用于遍历全部链接或按时间筛选的查询接口（例如 `fetchRecentLinks(limit:)` 或 `fetchHighlightCountsByLink()`）。

- `SyncNos/SyncNosApp.swift`
- 无需改动（`autoSyncEnabled` 已控制 AutoSyncService 的启动）。

可选 UI/配置改动：

- 在 `SettingsView` 中加入 GoodLinks 专属开关（例如单独控制 GoodLinks auto-sync）或在 Notion Integration 中提供 syncMode 选择（已有），视需求可选实现。

实现细节（关键点）：

- 复用 `SyncTimestampStore` 存储每个 Link 的最后同步时间：`SyncTimestampStore` 已为 book assetId 提供 API，计划直接复用，key 使用 link.id（字符串）。
- 并发控制：与书籍同步相同的 bounded concurrency（保持现有 maxConcurrentBooks 常量或抽象为 `maxConcurrentTasks`）。
- 通知：复用现有通知名称（例如 `SyncBookStarted` / `SyncBookFinished` / `SyncBookStatusChanged`）并在 userInfo 中增加 `source: "goodlinks"` 或新增 `SyncLinkStarted` 等命名，保证 UI 与日志能区分来源。
- 错误与日志：使用 DIContainer.shared.loggerService 记录每个链接的开始/成功/失败，异常不应阻塞其它链接的同步。
- 时间/频率节流：使用 `SyncTimestampStore.getLastSyncTime(for:)` 决定是否跳过短时间内已同步的 link（与 books 相同阈值 `intervalSeconds`）。
- 恢复与权限：使用 `GoodLinksBookmarkStore.shared.restore()` + `startAccessing()` 解决沙盒文件访问权限，参照 `GoodLinksDatabaseService.resolveDatabasePath()` 的实现。

验收标准（验收测试）：

- 启用 `autoSyncEnabled` 后，AutoSyncService 同时尝试对 Apple Books 和 GoodLinks 执行同步（在控制台/日志能看到 GoodLinks 的同步日志）。
- 当 GoodLinks 未配置（未选目录或 Notion 未配置）时，良好日志并跳过同步且不 crash。
- 同一个 link 在短时间内不会被重复同步（由 `SyncTimestampStore` 节流）。
- 并发多链接同步不会相互影响，失败的链接不会阻止其它链接继续。

建议的实现步骤（todos）：

- enable-goodlinks-detection: 在 `AutoSyncService` 中添加 GoodLinks 路径检测与 bookmark 恢复逻辑
- wire-goodlinks-notifications: 在 `AutoSyncService.start()` 中监听 `GoodLinksFolderSelected` 和 `RefreshGoodLinksRequested` 通知
- implement-syncAllGoodLinks: 实现 `syncAllGoodLinksSmart(dbPath:)` 方法，使用 `GoodLinksDatabaseService` 枚举 link id 并调用 `GoodLinksSyncService`
- integrate-timestamps-and-concurrency: 将 `SyncTimestampStore` 与 bounded concurrency 融入 GoodLinks 同步流程
- logging-and-notifications: 添加日志记录与通知（start/finished/status）以便 UI 更新
- manual-testing: 本地验证包括启动、触发事件、定时器触发、错误路径以及并发行为

如果你同意这个方案，我会把上面的计划转换为具体的代码 edits（优先修改 `AutoSyncService.swift`），并在实现前列出每步的具体代码变更与短代码引用供你确认。

### To-dos

- [ ] 在 `AutoSyncService` 中添加 GoodLinks 路径检测与 bookmark 恢复逻辑
- [ ] 在 `AutoSyncService.start()` 中监听 `GoodLinksFolderSelected` 和 `RefreshGoodLinksRequested` 通知
- [ ] 实现 `syncAllGoodLinksSmart(dbPath:)`，枚举 GoodLinks 链接并调用 `GoodLinksSyncService`
- [ ] 使用 `SyncTimestampStore` 节流并在 `withTaskGroup` 中限制并发
- [ ] 为每个 link 的开始/完成/失败发送通知并记录日志
- [ ] 手动在本地验证自动同步行为（启用/禁用、通知触发、并发与错误场景）