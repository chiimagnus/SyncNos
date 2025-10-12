<!-- bb8c163b-25c4-4083-a3e1-5b114400a123 7b5dce3a-ca8a-4378-803d-4a6e233728d2 -->
# Per-Source Settings Refactor

目标：将与“来源”（Apple Books、GoodLinks）相关的设置（同步模式、按源 DB ID、自动同步开关）按来源分组，提升可维护性与 UX。保留 `NotionIntegrationView` 作为全局 Notion 凭据与测试页。

变更概要（具体文件）

- 新增：
  - `SyncNos/Views/Settting/AppleBooksSettingsView.swift`（View）
  - `SyncNos/ViewModels/AppleBooksSettingsViewModel.swift`（ViewModel）
  - `SyncNos/Views/Settting/GoodLinksSettingsView.swift`（View）
  - `SyncNos/ViewModels/GoodLinksSettingsViewModel.swift`（ViewModel）
- 修改：
  - `SyncNos/Views/Settting/SettingsView.swift`：把原全局 Auto Sync 切为两个按源开关并添加到 Integrations 区块的 NavigationLink（或直接显示两个开关）；新增导航到两个来源设置页。
  - `SyncNos/Views/Settting/NotionIntegrationView.swift`：移除或只读显示 per-source DB ID，保留全局 `NOTION_KEY` / `NOTION_PAGE_ID`。
  - `SyncNos/ViewModels/NotionIntegrationViewModel.swift`：移除 `appleBooksDbId` / `goodLinksDbId` 的 UI 绑定与保存逻辑（迁移到对应来源的 ViewModel）。
  - `SyncNos/Services/Infrastructure/AutoSyncService.swift`：先仅读取并尊重 `AppleBooks` 的按源开关（`@AppStorage("autoSync.appleBooks")`）；`GoodLinks` 的开关在 UI 中为占位符，暂不接入业务逻辑，后续实现 GoodLinks 自动同步时再接入。

关键实现要点

- 按源 Auto Sync 存储（UI 绑定）：
```swift
@AppStorage("autoSync.appleBooks") private var autoSyncAppleBooks: Bool = false
@AppStorage("autoSync.goodLinks") private var autoSyncGoodLinks: Bool = false // 占位符，暂不生效
```

- AppleBooksSettingsViewModel 使用现有 `NotionConfigStore` API：
  - 读取：`notionConfig.appleBooksDatabaseId()`
  - 写入：`notionConfig.setAppleBooksDatabaseId(_:)`
  - 保存 `syncMode` 使用现有 `notionConfig.syncMode`
- GoodLinksSettingsViewModel 类似，使用 `goodLinksDatabaseId()` / `setGoodLinksDatabaseId(_:)`。
- `AutoSyncService.triggerSyncNow()`：在触发书籍遍历前先检查 `autoSyncAppleBooks`，若为 false 则跳过 AppleBooks 自动同步。暂不读取 `autoSync.goodLinks`，以避免误触未实现的 GoodLinks 同步路径。

GoodLinks 自动同步占位说明（重要）

- GoodLinks 的自动同步功能尚未实现，因此：
  - 在 `GoodLinksSettingsView` 中仍显示 `Auto Sync` 开关供用户设置，但该开关为占位（UI 可交互或禁用、并带有帮助提示），并不会被 `AutoSyncService` 读取或触发任何 GoodLinks 同步流程。
  - 在未来实现 GoodLinks 自动同步时，需要在 `AutoSyncService` 或单独的 GoodLinks 自动同步服务中读取该开关并实现触发逻辑。

迁移与兼容策略

- 先在 UI 层迁移字段（先移动 DB ID 输入到新页面），同时在 `NotionIntegrationViewModel` 保留旧字段但不暴露 UI，等待确认后再删除以保证回滚安全。
- 在 `AutoSyncService` 中增加读取 `autoSync.appleBooks` 的逻辑，但不改变默认行为（默认不开启）；GoodLinks 相关的逻辑保留为未来任务。

实现步骤（todos）

- id: create-views

content: Create `AppleBooksSettingsView` and `GoodLinksSettingsView` and their SwiftUI layout

- id: create-viewmodels

content: Create `AppleBooksSettingsViewModel` and `GoodLinksSettingsViewModel` using `NotionConfigStore` for per-source DB ID

- id: update-settingsview

content: Update `SettingsView.swift` to expose per-source Auto Sync switches and NavigationLinks to new pages

- id: update-notion-view

content: Remove per-source DB ID inputs from `NotionIntegrationView` (or make them read-only) and keep global credentials

- id: update-notion-vm

content: Remove per-source DB ID persistence from `NotionIntegrationViewModel` and migrate logic to the new ViewModels

- id: update-autosync

content: Modify `AutoSyncService` to respect `autoSync.appleBooks` flag; leave `autoSync.goodLinks` as UI-only placeholder until GoodLinks auto-sync is implemented

- id: lint-and-test

content: Run linter and verify builds; fix minor issues and ensure no behavioral regressions

时间估计（粗略）

- 总计：2 - 4 小时（包括本地编译与基本手动验证）

备注与风险

- 现有 `SettingsView` 使用 `DIContainer.shared.autoSyncService.start()`/`stop()`：我们将保持 DI 调用不变，`AutoSyncService` 内部决定按源行为。
- 迁移过程中保留向后兼容的保存逻辑以便回滚。

下一步

- 如果你确认此计划，我将开始实现（先创建 View + ViewModel），按 todos 有序推进并在每一步更新进度与 linter 结果。

### To-dos

- [ ] Create `AppleBooksSettingsView` and `GoodLinksSettingsView` and their SwiftUI layout
- [ ] Create `AppleBooksSettingsViewModel` and `GoodLinksSettingsViewModel` using `NotionConfigStore` for per-source DB ID
- [ ] Update `SettingsView.swift` to expose per-source Auto Sync switches and NavigationLinks to new pages
- [ ] Remove per-source DB ID inputs from `NotionIntegrationView` (or make them read-only) and keep global credentials
- [ ] Remove per-source DB ID persistence from `NotionIntegrationViewModel` and migrate logic to the new ViewModels
- [ ] Modify `AutoSyncService` to respect per-source `@AppStorage` auto-sync flags when starting/triggering
- [ ] Run linter and verify builds; fix minor issues and ensure no behavioral regressions