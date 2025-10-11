<!-- 71e46b16-5a97-4812-b558-e5c13cfa5e2f 8e9b5286-25e8-4e5c-8bf2-4b06113527ad -->
# 复用 Notion 页面下已有 database（避免重复创建）

目标：在使用相同 `pageId` 同步时，优先检测并复用该 `page` 下已有的 Notion `database`（`child_database`），只有在确认不存在时才创建新的 `database`。避免用户卸载重装后因为本地配置丢失而重复创建数据库。

总体策略（精简版）：

1. 先尝试使用本地缓存（以 `pageId` 为 key 的映射），并验证缓存的 `databaseId` 是否有效且 parent 为目标 `pageId`。
2. 若缓存无效或不存在，优先在目标 `page` 下枚举 children（GET /v1/blocks/{page_id}/children，支持分页）查找 `child_database`。
3. 如果找到一个或多个 `child_database`：

- 若只有一个，直接复用并写回配置：`NotionConfigStore.setDatabaseId(_:forPage:)`。
- 若多个，短期策略：选第一个并写回配置；长期：在 UI 提示用户选择（单独迭代）。

4. 若未找到，才使用现有 `/search` 作为最后的 fallback（按 title 匹配）；找不到时创建新 database 并写回配置。
5. 全程执行明确的错误处理（权限、404、rate limit），记录日志并向用户展示可理解的提示信息。
6. 通过 feature-flag/版本逐步发布，先在内部或特定用户组启用后再全面 rollout。

必须修改/新增的代码位置与精确变更（含函数签名建议）

- `SyncNos/SyncNos/Services/0-NotionAPI/Configuration/NotionConfigStore.swift`
- 新增 API：
 - `func databaseIdForPage(_ pageId: String) -> String?`
 - `func setDatabaseId(_ id: String?, forPage pageId: String)`
- 迁移策略：如果现有 `perSource`/`perBook` 值存在但未按 page 存储，尝试在首次 ensure 时写入 `pageId->databaseId` 映射。
- 注意：保留现有 `databaseIdForSource`/`ForBook` API 向后兼容，但优先使用 `databaseIdForPage` 在 ensure 逻辑中查找缓存。

- `SyncNos/SyncNos/Services/0-NotionAPI/Core/NotionRequestHelper.swift`（或 `NotionServiceCore` 辅助）
- 确保有通用请求方法（已有），新增或确认支持：
 - 支持 `GET /v1/blocks/{page_id}/children?start_cursor=...` 的分页请求。

- `SyncNos/SyncNos/Services/0-NotionAPI/Operations/NotionDatabaseOperations.swift`
- 新增/修改函数：
 - `func findDatabasesUnderPage(parentPageId: String) async throws -> [String]`
 - 实现：分页调用 `blocks/{parentPageId}/children`，解析每个 child，挑出 `type == "child_database"` 并收集其 `id`（child 的 `id` 即为数据库 id）。
 - 将现有 `findDatabaseId(title:parentPageId:)` 调整为先调用 `findDatabasesUnderPage(parentPageId:)`，再按 title match 或 fallback 到 `/search`。
 - 可选：`func findDatabaseIdByTitleUnderPage(title:String, parentPageId:String) async throws -> String?`，通过先列出 children 再比对 title（更可靠）。

- `SyncNos/SyncNos/Services/0-NotionAPI/Core/NotionService.swift`
- 修改 `ensureDatabaseIdForSource(title:parentPageId:sourceKey:)` 实现：

 1. 如果存在 `core.configStore.databaseIdForPage(parentPageId)`，先验证（`databaseExists` 并检查 parent），若通过返回。
 2. 否则调用 `databaseOps.findDatabasesUnderPage(parentPageId)`：

 - 若找到一项或多项，挑选并写入 `setDatabaseId(..., forSource: sourceKey)` 与 `setDatabaseId(..., forPage: parentPageId)`，返回该 id。

 1. 否则 fallback 到 `databaseOps.findDatabaseId(title: parentPageId:)`（保留现有 `/search` 逻辑）。
 2. 最后才调用 `databaseOps.createDatabase(title:pageId:)` 并写回配置。

- 推荐新增小 helper（签名示例）：
 - `func listPageChildren(pageId: String, startCursor: String?) async throws -> (results: [[String: Any]], nextCursor: String?)`（可放在 `NotionRequestHelper`）

- `SyncNos/SyncNos/Services/0-NotionAPI/1-AppleBooksSyncToNotion/AppleBooksSyncService.swift`
- 不需要在这里大量改动（已通过 `notionService.ensureDatabaseIdForSource` 间接使用），但确保调用点使用 `core.configStore.notionPageId` 作为 parentPageId 参数并在错误提示中包含说明（例如 permissions）。

错误处理与权限

- 在调用 `blocks/{page_id}/children` 时处理：
- 403/401 -> 向用户提示授权问题并记录日志；建议 UI 提示用户重新授权 Notion integration。
- 404 -> page id 无效 -> 抛出明确错误，提示用户检查 pageId。
- rate limit (429) -> 重试策略（指数退避，最多 3 次）。

多 database 情况的 UX 决策

- 短期：默认选第一个 child_database；在日志中记录候选列表并在 `NotionConfigStore` 记录第一个 id。
- 长期（后续迭代）：实现一个 UI 弹窗让用户选择目标数据库（并写回配置）。

测试计划

- 单元测试（使用 Mock `NotionRequestHelper`）：
- 测试 `findDatabasesUnderPage`：验证分页解析与 `child_database` 过滤。
- 测试 `ensureDatabaseIdForSource`：场景覆盖
 - 缓存有效 -> 直接返回
 - 缓存失效，page 下有单个 db -> 复用
 - page 下有多个 db -> 选第一个并记录
 - page 下无 db，但 `/search` 命中 -> 复用
 - 都未命中 -> 创建新 db
- 权限错误、404、429 的行为验证（模拟 HTTP 错误）。

迁移与回滚

- 迁移：一次性更新 `NotionConfigStore`，在首次 ensure 时如果发现旧 `perSource`/`perBook` 缓存且没有 `pageId` mapping，尝试写入 `pageId -> databaseId`（如果能推断 pageId）。如果推断失败，只保留旧配置不删除。
- 回滚：保留旧逻辑（fallback 到 `/search` 和 create），任何失败不会导致数据丢失，只可能创建新 DB（与当前行为一致）。

发布策略（安全上线）

1. 实现并在内部/开发者环境验证（Mock Notion 或使用测试 workspace）。
2. 使用 feature-flag（`NotionSyncConfig.enablePageChildLookup`）在少量用户/测试者开启。
3. 监控（日志、错误率、创建 database 计数），确认稳定后逐步放开。

实施 TODO（供你批准 — 更细粒度）

- `add-config-page-mapping`：新增 `databaseIdForPage` / `setDatabaseId(..., forPage:)` 到 `NotionConfigStore`（pending）
- `add-request-helper-children`：在 `NotionRequestHelper` 添加对 `blocks/{page_id}/children` 的分页支持（pending）
- `impl-find-dbs-under-page`：实现 `NotionDatabaseOperations.findDatabasesUnderPage(parentPageId:)` 并过滤 `child_database`（pending）
- `modify-ensure-flow`：修改 `NotionService.ensureDatabaseIdForSource` 以优先使用 page children 并写回 `pageId->databaseId` 映射（pending）
- `tests-notion-db-find`：为新的查找与 ensure 逻辑添加单元测试（mock NotionRequestHelper）（pending）
- `feature-flag-rollout`：新增 feature flag `NotionSyncConfig.enablePageChildLookup` 并准备监控/回滚策略（pending）

### To-dos

- [ ] 新增 `databaseIdForPage` / `setDatabaseId(..., forPage:)` 到 `NotionConfigStore`
- [ ] 在 `NotionRequestHelper` 添加 `blocks/{page_id}/children` 的分页支持
- [ ] 实现 `NotionDatabaseOperations.findDatabasesUnderPage(parentPageId:)` 并过滤 `child_database`
- [ ] 修改 `NotionService.ensureDatabaseIdForSource` 以优先使用 page children 并写回 `pageId->databaseId` 映射
- [ ] 为新的查找与 ensure 逻辑添加单元测试（mock NotionRequestHelper）
- [ ] 新增 feature flag `NotionSyncConfig.enablePageChildLookup` 并准备监控/回滚策略