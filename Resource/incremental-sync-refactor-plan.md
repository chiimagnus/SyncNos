# 增量同步机制重构方案

## 一、当前问题分析

### 1.1 现有架构问题

#### WeRead → 本地缓存（已实现）
- ✅ 使用 `synckey` 增量同步
- ✅ 支持新增、修改、删除
- ⚠️ 首次加载需要等待全部数据

#### 本地数据 → Notion（问题较多）
- ❌ **代码重复**：`AppleBooksSyncStrategySingleDB`、`GoodLinksSyncService` 有大量重复逻辑
- ❌ **不支持删除**：本地删除的高亮不会从 Notion 删除
- ❌ **效率低下**：每次同步都需要获取 Notion 全部数据进行比对
- ❌ **Token 计算复杂**：需要维护 UUID→BlockID→Token 映射
- ❌ **缺乏统一抽象**：每个数据源都有自己的同步实现

### 1.2 代码重复示例

```swift
// AppleBooksSyncStrategySingleDB.swift (Line 190-217)
let existingMapWithToken = try await notionService.collectExistingUUIDMapWithToken(fromPageId: pageId)
for h in page {
    if let existing = existingMapWithToken[h.uuid] {
        let localToken = helper.computeModifiedToken(for: h, source: "appleBooks")
        if let remote = existing.token, remote == localToken {
            // equal -> skip
        } else {
            toUpdate.append((existing.blockId, h))
        }
    } else {
        toAppend.append(h)
    }
}

// GoodLinksSyncService.swift (Line 161-188) - 几乎相同的逻辑
let existingMapWithToken = try await notionService.collectExistingUUIDMapWithToken(fromPageId: pageId)
for h in collected {
    if let existing = existingMapWithToken[h.id] {
        let localToken = helper.computeModifiedToken(for: fakeHighlight, source: "goodLinks")
        if let remoteToken = existing.token, remoteToken == localToken {
            // Equal → skip
        } else {
            toUpdate.append((existing.blockId, fakeHighlight))
        }
    } else {
        toAppendHighlights.append(fakeHighlight)
    }
}
```

---

## 二、重构目标

### 2.1 核心目标

1. **统一同步协议**：所有数据源使用相同的同步接口
2. **支持完整 CRUD**：新增、修改、删除都能正确同步
3. **减少代码重复**：抽取公共同步逻辑
4. **提升效率**：减少不必要的 API 调用
5. **简化维护**：新增数据源只需实现数据适配器

### 2.2 设计原则

- **单一职责**：同步引擎只负责同步，不关心数据来源
- **开闭原则**：新增数据源不需要修改同步引擎
- **依赖倒置**：同步引擎依赖抽象，不依赖具体实现

---

## 三、新架构设计

### 3.1 核心组件

```
┌─────────────────────────────────────────────────────────────────┐
│                      SyncEngine (统一同步引擎)                    │
│  - 负责 Notion API 调用                                          │
│  - 负责变更检测（新增/修改/删除）                                  │
│  - 负责批量操作优化                                               │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ 使用
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    SyncDataProvider (数据提供者协议)              │
│  - getAllItems() -> [SyncItem]                                  │
│  - getItemsSince(date:) -> [SyncItem]  // 增量                   │
│  - getDeletedItemIds() -> [String]     // 已删除的 ID            │
└─────────────────────────────────────────────────────────────────┘
                              ▲
          ┌───────────────────┼───────────────────┐
          │                   │                   │
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ AppleBooksData  │  │  GoodLinksData  │  │   WeReadData    │
│    Provider     │  │    Provider     │  │    Provider     │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 3.2 数据模型

```swift
/// 统一的同步项目
struct SyncItem: Identifiable {
    let id: String              // 唯一标识（UUID）
    let parentId: String        // 所属书籍/文章 ID
    let text: String            // 高亮文本
    let note: String?           // 笔记
    let style: Int?             // 颜色索引
    let createdAt: Date?        // 创建时间
    let modifiedAt: Date?       // 修改时间
    let location: String?       // 位置信息
    let metadata: [String: Any] // 扩展元数据（如 reviewContents）
    
    /// 计算变更 Token（用于检测修改）
    var changeToken: String {
        // 基于内容的哈希
    }
}

/// 同步目标（书籍/文章）
struct SyncTarget {
    let id: String
    let title: String
    let author: String
    let url: String?
    let source: SyncSource
}

/// 数据来源
enum SyncSource: String {
    case appleBooks
    case goodLinks
    case weRead
}
```

### 3.3 同步引擎接口

```swift
/// 同步引擎协议
protocol SyncEngineProtocol {
    /// 同步单个目标的所有项目到 Notion
    func sync(
        target: SyncTarget,
        items: [SyncItem],
        deletedIds: [String],
        progress: @escaping (String) -> Void
    ) async throws -> SyncResult
}

/// 同步结果
struct SyncResult {
    let added: Int
    let updated: Int
    let deleted: Int
    let skipped: Int
}
```

### 3.4 数据提供者协议

```swift
/// 数据提供者协议
protocol SyncDataProviderProtocol {
    /// 数据来源标识
    var source: SyncSource { get }
    
    /// 获取所有同步目标（书籍/文章列表）
    func getAllTargets() async throws -> [SyncTarget]
    
    /// 获取指定目标的所有同步项目
    func getItems(for targetId: String) async throws -> [SyncItem]
    
    /// 获取指定目标自某时间以来修改的项目（增量）
    func getItemsSince(_ date: Date?, for targetId: String) async throws -> [SyncItem]
    
    /// 获取已删除的项目 ID（如果数据源支持）
    func getDeletedItemIds(for targetId: String) async throws -> [String]
}
```

---

## 四、实现计划

### Phase 1: 基础设施（2-3小时）

#### 1.1 创建统一数据模型
- [ ] 创建 `SyncNos/Services/Sync/Models/SyncModels.swift`
  - `SyncItem` - 统一的同步项目
  - `SyncTarget` - 同步目标
  - `SyncSource` - 数据来源枚举
  - `SyncResult` - 同步结果

#### 1.2 创建同步引擎协议
- [ ] 创建 `SyncNos/Services/Sync/Engine/SyncEngineProtocol.swift`
  - 定义同步引擎接口
  - 定义数据提供者接口

### Phase 2: 同步引擎实现（3-4小时）

#### 2.1 实现核心同步引擎
- [ ] 创建 `SyncNos/Services/Sync/Engine/NotionSyncEngine.swift`
  - 实现 `SyncEngineProtocol`
  - 统一的变更检测逻辑
  - 支持新增、修改、删除
  - 批量操作优化

#### 2.2 变更检测逻辑
```swift
func detectChanges(
    localItems: [SyncItem],
    remoteItems: [String: RemoteItem],
    deletedIds: [String]
) -> ChangeSet {
    var toAdd: [SyncItem] = []
    var toUpdate: [(blockId: String, item: SyncItem)] = []
    var toDelete: [String] = []
    
    // 1. 检测新增和修改
    for item in localItems {
        if let remote = remoteItems[item.id] {
            // 存在：检查是否需要更新
            if item.changeToken != remote.token {
                toUpdate.append((remote.blockId, item))
            }
        } else {
            // 不存在：新增
            toAdd.append(item)
        }
    }
    
    // 2. 检测删除
    for deletedId in deletedIds {
        if let remote = remoteItems[deletedId] {
            toDelete.append(remote.blockId)
        }
    }
    
    return ChangeSet(toAdd: toAdd, toUpdate: toUpdate, toDelete: toDelete)
}
```

### Phase 3: 数据提供者实现（2-3小时）

#### 3.1 Apple Books 数据提供者
- [ ] 创建 `SyncNos/Services/Sync/Providers/AppleBooksDataProvider.swift`
  - 实现 `SyncDataProviderProtocol`
  - 从 SQLite 读取数据
  - 转换为 `SyncItem`

#### 3.2 GoodLinks 数据提供者
- [ ] 创建 `SyncNos/Services/Sync/Providers/GoodLinksDataProvider.swift`
  - 实现 `SyncDataProviderProtocol`
  - 从 SQLite 读取数据
  - 转换为 `SyncItem`

#### 3.3 WeRead 数据提供者
- [ ] 创建 `SyncNos/Services/Sync/Providers/WeReadDataProvider.swift`
  - 实现 `SyncDataProviderProtocol`
  - 从 SwiftData 缓存读取数据
  - 转换为 `SyncItem`

### Phase 4: 重构现有服务（2-3小时）

#### 4.1 重构 AppleBooksSyncService
- [ ] 使用新的同步引擎
- [ ] 删除重复代码
- [ ] 保持向后兼容

#### 4.2 重构 GoodLinksSyncService
- [ ] 使用新的同步引擎
- [ ] 删除重复代码
- [ ] 保持向后兼容

#### 4.3 创建 WeReadSyncService
- [ ] 使用新的同步引擎
- [ ] 实现 WeRead → Notion 同步

### Phase 5: 删除检测支持（1-2小时）

#### 5.1 实现删除检测
- [ ] 在同步引擎中添加删除逻辑
- [ ] 添加用户确认选项（可选）
- [ ] 添加"软删除"选项（标记而非删除）

#### 5.2 更新 Notion 操作
- [ ] 添加 `deleteBlock(blockId:)` 方法
- [ ] 添加批量删除支持

### Phase 6: 测试和优化（1-2小时）

- [ ] 单元测试
- [ ] 集成测试
- [ ] 性能优化
- [ ] 文档更新

---

## 五、文件结构

```
SyncNos/Services/Sync/
├── Models/
│   └── SyncModels.swift              # 统一数据模型
├── Engine/
│   ├── SyncEngineProtocol.swift      # 同步引擎协议
│   └── NotionSyncEngine.swift        # Notion 同步引擎实现
├── Providers/
│   ├── SyncDataProviderProtocol.swift # 数据提供者协议
│   ├── AppleBooksDataProvider.swift   # Apple Books 数据提供者
│   ├── GoodLinksDataProvider.swift    # GoodLinks 数据提供者
│   └── WeReadDataProvider.swift       # WeRead 数据提供者
└── Legacy/                            # 旧代码（逐步迁移后删除）
    ├── AppleBooksAutoSyncProvider.swift
    ├── GoodLinksAutoSyncProvider.swift
    └── ...
```

---

## 六、迁移策略

### 6.1 渐进式迁移

1. **第一阶段**：新代码与旧代码并存
   - 新同步引擎作为可选项
   - 用户可以选择使用新/旧同步方式

2. **第二阶段**：默认使用新引擎
   - 新同步引擎成为默认
   - 旧代码保留作为备份

3. **第三阶段**：删除旧代码
   - 确认稳定后删除旧实现
   - 清理遗留代码

### 6.2 向后兼容

- 保持现有 API 接口不变
- 内部实现替换为新引擎
- 用户无感知升级

---

## 七、预期收益

| 维度 | 改进前 | 改进后 |
|------|--------|--------|
| 代码重复 | ~300 行重复代码 | 统一引擎，无重复 |
| 删除支持 | ❌ 不支持 | ✅ 完整支持 |
| 新增数据源 | 需要 ~200 行代码 | 只需 ~50 行适配器 |
| 维护成本 | 高（多处修改） | 低（单点修改） |
| 测试覆盖 | 分散 | 集中 |

---

## 八、风险评估

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 迁移导致数据丢失 | 低 | 高 | 渐进式迁移，保留旧代码 |
| 性能下降 | 中 | 中 | 性能测试，批量优化 |
| API 兼容性问题 | 低 | 中 | 保持接口不变 |
| 用户体验变化 | 低 | 低 | 保持行为一致 |

---

## 九、时间估算

| 阶段 | 预估时间 |
|------|----------|
| Phase 1: 基础设施 | 2-3 小时 |
| Phase 2: 同步引擎 | 3-4 小时 |
| Phase 3: 数据提供者 | 2-3 小时 |
| Phase 4: 重构服务 | 2-3 小时 |
| Phase 5: 删除支持 | 1-2 小时 |
| Phase 6: 测试优化 | 1-2 小时 |
| **总计** | **11-17 小时** |

---

*创建日期: 2025-01-25*
*完成日期: 2025-01-25*
*状态: 已完成*

---

## 十、实现总结

### 已创建的文件

1. **`Services/Sync/Models/SyncModels.swift`**
   - `SyncTarget` - 统一的同步目标模型
   - `SyncItem` - 统一的同步项目模型（含 changeToken 计算）
   - `SyncResult` - 同步结果
   - `SyncError` - 同步错误
   - `ChangeSet` - 变更集合
   - `SyncState` - 同步状态
   - `SyncOptions` - 同步选项

2. **`Services/Sync/Engine/SyncEngineProtocol.swift`**
   - `SyncEngineProtocol` - 同步引擎协议
   - `SyncDataProviderProtocol` - 数据提供者协议
   - `UnifiedSyncServiceProtocol` - 统一同步服务协议

3. **`Services/Sync/Engine/NotionSyncEngine.swift`**
   - 核心同步引擎实现
   - 支持新增、修改、删除检测
   - 批量操作优化

4. **`Services/Sync/Providers/AppleBooksDataProvider.swift`**
   - Apple Books 数据提供者

5. **`Services/Sync/Providers/GoodLinksDataProvider.swift`**
   - GoodLinks 数据提供者

6. **`Services/Sync/Providers/WeReadDataProvider.swift`**
   - WeRead 数据提供者

7. **`Services/Sync/UnifiedSyncService.swift`**
   - 统一同步服务（整合数据提供者和同步引擎）

### 已修改的文件

1. **`Models/SyncQueueModels.swift`**
   - 扩展 `SyncSource` 添加 `displayName` 和 `notionDatabaseTitle`

2. **`Services/Core/DIContainer.swift`**
   - 注册 `UnifiedSyncService`

3. **`Services/DataSources-To/Notion/Core/NotionService.swift`**
   - 添加 `deleteBlockInternal` 方法支持删除操作

### 使用方式

```swift
// 1. 获取统一同步服务
let syncService = DIContainer.shared.unifiedSyncService

// 2. 设置数据库路径（Apple Books / GoodLinks）
syncService.setAppleBooksDbPath(dbPath)

// 3. 同步单本书
let result = try await syncService.syncAppleBook(book, dbPath: dbPath) { progress in
    print(progress)
}

// 4. 同步 WeRead 书籍
let result = try await syncService.syncWeReadBook(book) { progress in
    print(progress)
}

// 5. 同步所有目标
let results = try await syncService.syncAllTargets(for: .appleBooks) { progress in
    print(progress)
}
```

### 注意事项

- 旧的同步服务（`AppleBooksSyncService`、`GoodLinksSyncService`）仍然保留
- 新的 `UnifiedSyncService` 可以逐步替换旧服务
- 删除检测依赖数据源提供 `getDeletedItemIds()` 方法

