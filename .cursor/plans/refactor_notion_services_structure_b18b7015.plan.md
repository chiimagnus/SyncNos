---
name: Refactor_Notion_Services_Structure
overview: 按业务域重构 `Services/DataSources-To/Notion/`：将现有 Core/Operations/SyncEngine 重组为 Infra/Auth/Databases/Pages/Blocks/Highlights/Files/Sync，并在同一轮里把相关类型名同步重命名（你已允许改 public API）。
todos: []
isProject: false
---

## 推荐方案（为什么选 A：按资源域/业务域）

你当前的结构：`Configuration/` + `Core/` + `Operations/` + `SyncEngine/` 更像“技术分层”。对开发者而言，新增/查找 Notion 能力时更常见的心智模型是按 Notion 资源域：Databases、Pages、Blocks、Files、Auth、Sync。

因此我建议采用 **按业务域拆分**：

- 更容易定位文件（“要改 Blocks children 就去 Blocks/”）
- 和 Notion API 的资源边界一致（长期更稳）
- 允许在每个域内逐步演进（例如以后加 `Blocks/Models`、`Pages/Builders`）

## 目标目录树（提案）

将 [`SyncNos/Services/DataSources-To/Notion/`](SyncNos/Services/DataSources-To/Notion/) 重构为：

- `Config/`
  - `NotionConfigStore.swift`（可选改名为 `NotionConfigStore`→`NotionConfigRepository`）
  - `NotionSyncConfig.swift`
  - `NotionConfig.swift.example`
- `Infra/`
  - `NotionAPIClient.swift`（由 `NotionRequestHelper.swift` 重命名）
  - `NotionRateLimiter.swift`
- `Auth/`
  - `NotionOAuthService.swift`
  - `NotionOAuthConfig.swift`
- `Databases/`
  - `NotionDatabasesAPI.swift`（由 `NotionDatabaseOperations.swift` 重命名）
- `Pages/`
  - `NotionPagesAPI.swift`（由 `NotionPageOperations.swift` 重命名）
- `Blocks/`
  - `NotionBlocksAPI.swift`（由 `NotionQueryOperations.swift` + 相关 blocks children 功能聚合/更名；或保留为 Query）
- `Highlights/`
  - `NotionHighlightsAPI.swift`（由 `NotionHighlightOperations.swift` 重命名）
- `Files/`
  - `NotionFilesAPI.swift`（由 `NotionFileUploadOperations.swift` 重命名）
- `Sync/`
  - `NotionSyncEngine.swift`
  - `NotionSyncSourceProtocol.swift`
  - `SyncTimestampStore.swift`（可选改名为 `NotionSyncTimestampStore`）
  - `Adapters/*NotionAdapter.swift`
- `Utils/`
  - `NotionHelperMethods.swift`
  - `NotionHTMLToBlocksConverter.swift`
- `NotionClient.swift`
  - 由现 `Core/NotionService.swift` 重命名：作为 Facade 组合上述域 API（Databases/Pages/Blocks/Highlights/Files）

> 说明：Swift 编译不依赖文件路径，但我们会做“文件移动 + 类型/文件名改动 + 全量引用更新”，确保结构与命名一致。

## 类型重命名映射（提案）

- `NotionServiceProtocol` → `NotionClientProtocol`
- `NotionService` → `NotionClient`
- `NotionRequestHelper` → `NotionAPIClient`
- `NotionDatabaseOperations` → `NotionDatabasesAPI`
- `NotionPageOperations` → `NotionPagesAPI`
- `NotionQueryOperations` → `NotionBlocksAPI`（或 `NotionQueryAPI`，看你更想强调 Blocks 还是 Query）
- `NotionHighlightOperations` → `NotionHighlightsAPI`
- `NotionFileUploadOperations` → `NotionFilesAPI`

同时更新 DI：[`SyncNos/Services/Core/DIContainer.swift`](SyncNos/Services/Core/DIContainer.swift) 里 `notionService` 的命名/类型。

## 实施步骤（低风险顺序）

1. **冻结目标结构与命名表**

   - 将上述目录树与 rename 映射作为“本次重构唯一真相”。

2. **先移动文件（不改类型名）**

   - 只做文件夹创建与文件移动，让工程能在“路径变化但类型不变”的情况下仍能编译。

3. **再做类型重命名（从最底层到最上层）**

   - 先重命名 Infra：`NotionRequestHelper`/`NotionRateLimiter`
   - 再重命名各域 API：Databases/Pages/Blocks/Highlights/Files
   - 最后重命名 Facade 与协议：`NotionService(Protocol)` → `NotionClient(Protocol)`
   - 每一层 rename 都同步更新引用点（用全局搜索替换 + 编译校验）。

4. **同步更新 SyncEngine/Adapters 的依赖注入点**

   - `NotionSyncEngine` 持有的 service 类型随之调整。

5. **全局一致性检查**

   - 确保 `Services/DataSources-To/Notion/` 下不再出现旧命名文件/类型。
   - 确保 `DIContainer.shared.*` 的 API 一致。

## 受影响范围（已定位的主要引用点）

- DI：[`SyncNos/Services/Core/DIContainer.swift`](SyncNos/Services/Core/DIContainer.swift)
- Notion ViewModels：
  - [`SyncNos/ViewModels/Notion/NotionIntegrationViewModel.swift`](SyncNos/ViewModels/Notion/NotionIntegrationViewModel.swift)（OAuth）
  - [`SyncNos/ViewModels/Settings/OnboardingViewModel.swift`](SyncNos/ViewModels/Settings/OnboardingViewModel.swift)（OAuth）
- SyncEngine：[`SyncNos/Services/DataSources-To/Notion/SyncEngine/NotionSyncEngine.swift`](SyncNos/Services/DataSources-To/Notion/SyncEngine/NotionSyncEngine.swift) 及各 Adapter。

## 验证方式

- 你本地继续使用：
```bash
xcodebuild -scheme SyncNos build
```

- 重点回归路径：
  - Notion OAuth 登录/授权流程
  - 任意数据源（AppleBooks/GoodLinks/WeRead/Dedao/Chats）同步到 Notion
  - GoodLinks “Article + Highlights” 结构仍保持

## 可选项（若你愿意一起做）

- 更新 [`SyncNos/AGENTS.md`](SyncNos/AGENTS.md) 中关于 Notion 模块的描述（当前文案偏向“不需要修改 NotionSyncEngine/NotionService”，与重构事实不一致）。