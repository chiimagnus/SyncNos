# SyncQueueStore 重构计划：方案 2

> **状态**: ✅ 已完成  
> **创建日期**: 2025-12-08  
> **完成日期**: 2025-12-08  
> **相关 Git**: ff74328fa5c8d774a3544e442812bee94458347b

## 1. 背景与问题

### 1.1 当前实现

当前代码 (ff74328) 已通过以下方式解决快捷键连续触发导致的重复同步问题：

1. **ViewModel 层去重**：`bookIds.subtracting(syncingBookIds)`
2. **立即标记**：`syncingBookIds.insert(id)` 在 Task 启动前同步执行
3. **SyncQueueStore 通知监听**：被动接收 `SyncTasksEnqueued` 通知
4. **失败任务冷却机制**：60 秒内不允许重新入队

### 1.2 架构问题

| 问题 | 影响 |
|------|------|
| 去重逻辑分散在 4 个 ViewModel 中 | 代码重复，维护成本高 |
| `SyncQueueStore` 是被动的通知监听者 | 无法作为单一真相源 |
| 添加新数据源需要复制相同的去重逻辑 | 扩展性差 |
| ViewModel 的 `syncingBookIds` 与 `SyncQueueStore` 状态可能不一致 | 潜在的状态同步问题 |

## 2. 目标架构

### 2.1 架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SyncQueueStore (单一真相源)                      │
│                                                                         │
│  职责：                                                                  │
│  1. 任务入队（去重、冷却检查）                                            │
│  2. 任务状态管理                                                         │
│  3. 任务查询（isActive, snapshot）                                       │
│  4. UI 发布（tasksPublisher）                                            │
└─────────────────────────────────────────────────────────────────────────┘
                              ↑
                              │ 调用 enqueue() / 监听状态通知
                              │
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ AppleBooks   │  │  GoodLinks   │  │   WeRead     │  │    Dedao     │
│  ViewModel   │  │  ViewModel   │  │  ViewModel   │  │  ViewModel   │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

### 2.2 设计原则

- **单一真相源 (Single Source of Truth)**：`SyncQueueStore` 是同步任务状态的唯一管理者
- **依赖注入**：通过 `DIContainer` 提供 `SyncQueueStore`
- **协议驱动**：定义 `SyncQueueStoreProtocol` 支持测试和 mock
- **保留解耦**：状态变更（started/succeeded/failed）仍通过通知，保持组件解耦

## 3. 详细改动计划

### Phase 1: 扩展协议和模型

#### 3.1.1 新增入队项模型

**文件**: `SyncNos/Models/SyncQueueModels.swift`

```swift
/// 同步任务入队项
struct SyncEnqueueItem: Sendable {
    let id: String
    let title: String
    let subtitle: String?
    
    init(id: String, title: String, subtitle: String? = nil) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
    }
}
```

#### 3.1.2 扩展 SyncQueueStoreProtocol

**文件**: `SyncNos/Services/Core/Protocols.swift`

```swift
// MARK: - Sync Queue Store Protocol
protocol SyncQueueStoreProtocol: AnyObject {
    // 现有
    var snapshot: [SyncQueueTask] { get }
    var tasksPublisher: AnyPublisher<[SyncQueueTask], Never> { get }
    
    // 新增：同步入队，返回实际入队的任务 ID
    /// 将任务入队，自动处理去重和冷却检查
    /// - Parameters:
    ///   - source: 数据源类型
    ///   - items: 待入队的任务列表
    /// - Returns: 实际被接受入队的任务 ID 集合
    @MainActor
    func enqueue(source: SyncSource, items: [SyncEnqueueItem]) -> Set<String>
    
    // 新增：检查任务是否正在处理（queued 或 running）
    func isTaskActive(source: SyncSource, rawId: String) -> Bool
    
    // 新增：批量检查，返回正在处理的任务 ID
    func activeTaskIds(source: SyncSource, rawIds: Set<String>) -> Set<String>
}
```

### Phase 2: 实现 SyncQueueStore 新方法

**文件**: `SyncNos/Services/SyncScheduling/SyncQueueStore.swift`

```swift
// MARK: - Public API (新增)

@MainActor
func enqueue(source: SyncSource, items: [SyncEnqueueItem]) -> Set<String> {
    var acceptedIds: Set<String> = []
    
    stateQueue.sync {
        cancelScheduledCleanup_locked()
        let now = Date()
        
        for item in items {
            let taskId = "\(source.rawValue):\(item.id)"
            
            // 检查冷却期
            if let failedAt = failedTaskTimestamps[taskId],
               now.timeIntervalSince(failedAt) < failedTaskCooldownSeconds {
                continue
            }
            
            // 检查是否已存在（去重）
            if tasksById[taskId] != nil {
                continue
            }
            
            // 入队
            let task = SyncQueueTask(
                rawId: item.id,
                source: source,
                title: item.title,
                subtitle: item.subtitle,
                state: .queued
            )
            tasksById[taskId] = task
            enqueuedOrder.append(taskId)
            acceptedIds.insert(item.id)
        }
    }
    
    if !acceptedIds.isEmpty {
        publish()
    }
    
    return acceptedIds
}

func isTaskActive(source: SyncSource, rawId: String) -> Bool {
    let taskId = "\(source.rawValue):\(rawId)"
    return stateQueue.sync {
        guard let task = tasksById[taskId] else { return false }
        return task.state == .queued || task.state == .running
    }
}

func activeTaskIds(source: SyncSource, rawIds: Set<String>) -> Set<String> {
    stateQueue.sync {
        rawIds.filter { rawId in
            let taskId = "\(source.rawValue):\(rawId)"
            guard let task = tasksById[taskId] else { return false }
            return task.state == .queued || task.state == .running
        }
    }
}
```

### Phase 3: 简化 ViewModel 的 batchSync

#### 3.3.1 改动前（以 DedaoViewModel 为例）

```swift
func batchSync(bookIds: Set<String>, concurrency: Int = NotionSyncConfig.batchConcurrency) {
    guard !bookIds.isEmpty else { return }
    guard checkNotionConfig() else {
        NotificationCenter.default.post(name: Notification.Name("ShowNotionConfigAlert"), object: nil)
        return
    }
    
    // ❌ 冗余：ViewModel 层去重
    let idsToSync = bookIds.subtracting(syncingBookIds)
    guard !idsToSync.isEmpty else {
        logger.debug("[Dedao] All selected books are already syncing, skip")
        return
    }
    
    // ❌ 冗余：立即标记
    for id in idsToSync {
        syncingBookIds.insert(id)
    }
    
    // ❌ 冗余：发送通知入队
    let items: [[String: Any]] = idsToSync.compactMap { id in
        guard let b = displayBooks.first(where: { $0.bookId == id }) else { return nil }
        return ["id": id, "title": b.title, "subtitle": b.author]
    }
    if !items.isEmpty {
        NotificationCenter.default.post(
            name: Notification.Name("SyncTasksEnqueued"),
            object: nil,
            userInfo: ["source": "dedao", "items": items]
        )
    }
    
    // ... 启动 Task
}
```

#### 3.3.2 改动后

```swift
func batchSync(bookIds: Set<String>, concurrency: Int = NotionSyncConfig.batchConcurrency) {
    guard !bookIds.isEmpty else { return }
    guard checkNotionConfig() else {
        NotificationCenter.default.post(name: Notification.Name("ShowNotionConfigAlert"), object: nil)
        return
    }
    
    // ✅ 简化：通过 SyncQueueStore 入队
    let syncQueueStore = DIContainer.shared.syncQueueStore
    let items = bookIds.compactMap { id -> SyncEnqueueItem? in
        guard let b = displayBooks.first(where: { $0.bookId == id }) else { return nil }
        return SyncEnqueueItem(id: id, title: b.title, subtitle: b.author)
    }
    
    let acceptedIds = syncQueueStore.enqueue(source: .dedao, items: items)
    
    guard !acceptedIds.isEmpty else {
        logger.debug("[Dedao] No tasks accepted by SyncQueueStore, skip")
        return
    }
    
    // 更新本地 UI 状态
    for id in acceptedIds {
        syncingBookIds.insert(id)
    }
    
    // 只为 acceptedIds 启动同步
    let ids = Array(acceptedIds)
    let itemsById = Dictionary(uniqueKeysWithValues: books.map { ($0.bookId, $0) })
    // ... 后续同步逻辑保持不变
}
```

### Phase 4: 更新 AutoSyncProvider

AutoSyncProvider 也需要使用 `syncQueueStore.enqueue()` 来入队，而不是发送 `SyncTasksEnqueued` 通知。

**改动前**:
```swift
NotificationCenter.default.post(
    name: Notification.Name("SyncTasksEnqueued"),
    object: nil,
    userInfo: ["source": "dedao", "items": items]
)
```

**改动后**:
```swift
let syncQueueStore = DIContainer.shared.syncQueueStore
let enqueueItems = items.map { SyncEnqueueItem(id: $0["id"]!, title: $0["title"]!, subtitle: $0["subtitle"]) }
let acceptedIds = await MainActor.run {
    syncQueueStore.enqueue(source: .dedao, items: enqueueItems)
}
```

### Phase 5: 清理冗余代码

1. **保留 `handleEnqueue` 作为兼容层**：可以保留通知监听，但主要入队路径改为直接调用
2. **保留状态通知**：`SyncBookStatusChanged` 和 `SyncProgressUpdated` 通知保持不变
3. **保留 `syncingBookIds`**：用于 UI 状态显示，但不再用于去重

## 4. 文件改动清单

| 文件 | 改动类型 | 改动内容 | 预计行数 |
|------|---------|---------|---------|
| `SyncQueueModels.swift` | 新增 | 添加 `SyncEnqueueItem` | +15 |
| `Protocols.swift` | 扩展 | 添加 3 个新方法到协议 | +20 |
| `SyncQueueStore.swift` | 实现 | 实现 `enqueue`, `isTaskActive`, `activeTaskIds` | +50 |
| `DedaoViewModel.swift` | 简化 | 使用 `enqueue()` 替代通知 | -15 |
| `WeReadViewModel.swift` | 简化 | 使用 `enqueue()` 替代通知 | -15 |
| `AppleBooksViewModel.swift` | 简化 | 使用 `enqueue()` 替代通知 | -15 |
| `GoodLinksViewModel.swift` | 简化 | 使用 `enqueue()` 替代通知 | -15 |
| `AppleBooksAutoSyncProvider.swift` | 简化 | 使用 `enqueue()` 替代通知 | -10 |
| `GoodLinksAutoSyncProvider.swift` | 简化 | 使用 `enqueue()` 替代通知 | -10 |
| `WeReadAutoSyncProvider.swift` | 简化 | 使用 `enqueue()` 替代通知 | -10 |
| `DedaoAutoSyncProvider.swift` | 简化 | 使用 `enqueue()` 替代通知 | -10 |

**预计净代码量变化**: 约 -35 行（减少重复代码）

## 5. 兼容性考虑

### 5.1 保留的通知

| 通知名 | 保留原因 |
|-------|---------|
| `SyncBookStatusChanged` | 状态更新仍通过通知，保持解耦 |
| `SyncProgressUpdated` | 进度更新仍通过通知 |
| `ShowNotionConfigAlert` | 配置提示 |

### 5.2 废弃的通知

| 通知名 | 替代方案 |
|-------|---------|
| `SyncTasksEnqueued` | 直接调用 `syncQueueStore.enqueue()` |

### 5.3 渐进式迁移

可以先迁移一个数据源（如 Dedao），验证后再迁移其他数据源。

## 6. 预期收益

| 收益 | 说明 |
|------|------|
| **代码量减少** | 每个 ViewModel 减少约 15-20 行重复代码 |
| **单一真相源** | 去重逻辑集中在 `SyncQueueStore` |
| **易于扩展** | 新数据源只需调用 `enqueue(source: .newSource, ...)` |
| **可测试性** | 通过 mock `SyncQueueStoreProtocol` 测试 ViewModel |
| **状态一致性** | `SyncQueueStore` 是唯一的任务状态管理者 |

## 7. 测试计划

### 7.1 单元测试

- [ ] `SyncQueueStore.enqueue()` 去重测试
- [ ] `SyncQueueStore.enqueue()` 冷却期测试
- [ ] `SyncQueueStore.isTaskActive()` 测试
- [ ] `SyncQueueStore.activeTaskIds()` 测试

### 7.2 集成测试

- [ ] 快捷键连续触发不重复入队
- [ ] 失败任务冷却期内不入队
- [ ] 多数据源并发入队

### 7.3 UI 测试

- [ ] 同步队列 UI 正确显示
- [ ] 任务状态正确更新

## 8. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 状态不一致 | 低 | 中 | 保留 `handleEnqueue` 作为兼容层 |
| 性能影响 | 低 | 低 | `stateQueue.sync` 已是线程安全的 |
| 迁移遗漏 | 中 | 低 | 编译器会报错未实现的协议方法 |

## 9. 实施时间线

| 阶段 | 预计时间 | 内容 |
|------|---------|------|
| Phase 1 | 30 分钟 | 扩展协议和模型 |
| Phase 2 | 30 分钟 | 实现 SyncQueueStore 新方法 |
| Phase 3 | 1 小时 | 简化 4 个 ViewModel |
| Phase 4 | 30 分钟 | 更新 4 个 AutoSyncProvider |
| Phase 5 | 15 分钟 | 清理和测试 |
| **总计** | **约 2.5 小时** | |

---

## 附录：相关文件路径

```
SyncNos/
├── Models/
│   └── SyncQueueModels.swift          # 新增 SyncEnqueueItem
├── Services/
│   ├── Core/
│   │   ├── Protocols.swift            # 扩展 SyncQueueStoreProtocol
│   │   └── DIContainer.swift          # 无需修改
│   └── SyncScheduling/
│       ├── SyncQueueStore.swift       # 实现新方法
│       ├── AppleBooksAutoSyncProvider.swift
│       ├── GoodLinksAutoSyncProvider.swift
│       ├── WeReadAutoSyncProvider.swift
│       └── DedaoAutoSyncProvider.swift
└── ViewModels/
    ├── AppleBooks/
    │   └── AppleBooksViewModel.swift
    ├── GoodLinks/
    │   └── GoodLinksViewModel.swift
    ├── WeRead/
    │   └── WeReadViewModel.swift
    └── Dedao/
        └── DedaoViewModel.swift
```

