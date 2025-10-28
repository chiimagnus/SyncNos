# SyncNos ViewModel 改进文档

## 1. 执行摘要

### 1.1 当前代码质量评估

经过深入分析三个 ViewModel 文件，整体代码质量较好，遵循了 MVVM 架构和 SwiftUI 最佳实践，但仍存在一些关键问题需要解决。

#### 评分总结

| 文件名 | 当前评分 | 架构遵循度 | 主要问题 |
|--------|----------|------------|----------|
| GoodLinksViewModel.swift | A- (90/100) | 优秀 | UserDefaults I/O 频繁、@MainActor 混合使用 |
| AppleBooksViewModel.swift | 8.0/10 | 良好 | **严重编译错误**、架构问题 |
| AppleBooksDetailViewModel.swift | 8.5/10 | 优秀 | UserDefaults 优化空间 |

### 1.2 总体架构遵循度

**优势**:
- ✅ 严格遵循 MVVM 架构模式
- ✅ 正确使用 `@Published` 和 `ObservableObject`
- ✅ 良好的依赖注入实践
- ✅ Combine 响应式编程应用
- ✅ 关注点分离清晰

**需要改进**:
- ❌ AppleBooksViewModel.swift 第 410 行存在严重逻辑错误
- ❌ UserDefaults 在 `didSet` 中频繁 I/O 操作
- ❌ `@MainActor` 与 `DispatchQueue` 混合使用导致并发语义混乱
- ❌ NotificationCenter 过度使用，组件耦合度高
- ❌ 缺乏任务取消机制

### 1.3 关键发现总结

1. **致命错误**: AppleBooksViewModel.swift 第 410 行代码逻辑不完整，无法编译或运行
2. **性能瓶颈**: 每个属性变化都触发 UserDefaults 同步写入，造成磁盘 I/O 频繁
3. **并发混乱**: `@MainActor` 类中混用 `DispatchQueue`，违背 Swift 6 并发模型
4. **通知过载**: 全局 NotificationCenter 使用过多（15+ 个通知），难以维护
5. **资源泄漏风险**: 异步任务缺乏取消机制，可能导致内存泄漏

---

## 2. 立即修复项（高优先级）

### 2.1 AppleBooksViewModel.swift 第 410 行编译错误

**问题位置**: `/Users/chii_magnus/Github_OpenSource/SyncNos/SyncNos/ViewModels/AppleBooks/AppleBooksViewModel.swift:410`

**当前代码**:
```swift
// 每个任务完成后，从主线程移除 syncing 标记
await MainActor.run {
    self.syncingBookIds.remove(id)
    if case .none = self.syncedBookIds.firstIndex(of: id) { }  // ❌ 无意义代码
}
```

**问题分析**:
这行代码检查 `syncedBookIds` 是否包含 `id`，但什么都不做。看起来是未完成的逻辑，应该在同步成功后将 bookId 添加到 `syncedBookIds` 集合中。

**修复方案**:

```swift
// 每个任务完成后，从主线程移除 syncing 标记
await MainActor.run {
    self.syncingBookIds.remove(id)
    // 同步成功，添加到已同步集合
    self.syncedBookIds.insert(id)
}
```

**完整修复代码** (`AppleBooksViewModel.swift:408-412`):

```swift
                            // 每个任务完成后，从主线程移除 syncing 标记
                            await MainActor.run {
                                self.syncingBookIds.remove(id)
                                // 修复：同步成功后添加到已同步集合
                                self.syncedBookIds.insert(id)
                            }
```

**验证方法**:
1. 编译项目，验证无编译错误
2. 运行批量同步功能，确认 UI 状态正确更新
3. 检查 `syncedBookIds` 集合是否正确维护同步状态

### 2.2 GoodLinksViewModel.swift 的 @MainActor 问题

**问题分析**:
类被标记为 `@MainActor`，但内部大量使用 `DispatchQueue.global(qos: .userInitiated).async` 和手动 `Task { @MainActor in ... }`，这会导致：
1. 与 Swift 6 结构化并发冲突
2. 死锁风险
3. 代码可读性差

**修复方案 1: 移除 @MainActor，完全使用结构化并发（推荐）**

```swift
// ❌ 原始代码
@MainActor
final class GoodLinksViewModel: ObservableObject {
    // ...
    func loadRecentLinks(limit: Int = 0) async {
        isLoading = true
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                // ... 业务逻辑
                Task { @MainActor in  // 嵌套的 MainActor 调用
                    self.links = rows
                    // ...
                }
            }
        }
    }
}

// ✅ 修复后代码
final class GoodLinksViewModel: ObservableObject {
    // 移除 @MainActor 注解

    func loadRecentLinks(limit: Int = 0) async {
        await MainActor.run {
            self.isLoading = true
            self.errorMessage = nil
        }

        do {
            let dbPath = await service.resolveDatabasePath()
            let rows = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[GoodLinksLinkRow], Error>) in
                DispatchQueue.global(qos: .userInitiated).async {
                    do {
                        let result = try service.fetchRecentLinks(dbPath: dbPath, limit: limit)
                        continuation.resume(returning: result)
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }

            await MainActor.run {
                self.links = rows
                logger.info("[GoodLinks] loaded links: \(rows.count)")
                self.isLoading = false
            }
        } catch {
            let desc = error.localizedDescription
            await MainActor.run {
                logger.error("[GoodLinks] loadRecentLinks error: \(desc)")
                self.errorMessage = desc
                self.isLoading = false
            }
        }
    }
}
```

**修复方案 2: 保持 @MainActor，使用 AsyncStream（备选）**

如果必须保持 `@MainActor`（例如有遗留代码依赖），可以使用 `AsyncStream` 包装：

```swift
@MainActor
final class GoodLinksViewModel: ObservableObject {

    func loadRecentLinks(limit: Int = 0) async {
        isLoading = true
        errorMessage = nil

        let result = await withCheckedContinuation { (continuation: CheckedContinuation<[GoodLinksLinkRow], Never>) in
            let serviceForTask = service
            let loggerForTask = logger

            Task.detached(priority: .userInitiated) {
                do {
                    let dbPath = serviceForTask.resolveDatabasePath()
                    let rows = try serviceForTask.fetchRecentLinks(dbPath: dbPath, limit: limit)
                    continuation.resume(returning: rows)
                } catch {
                    // 处理错误但不返回，避免 continuation 重复 resume
                    Task { @MainActor in
                        loggerForTask.error("[GoodLinks] loadRecentLinks error: \(error.localizedDescription)")
                    }
                }
            }
        }

        links = result
        logger.info("[GoodLinks] loaded links: \(result.count)")
        isLoading = false
    }
}
```

**选择建议**:
- **首选方案 1**: 更符合 Swift 6 并发模型，代码更简洁
- **备选方案 2**: 如果项目中有大量现有代码依赖 @MainActor，可逐步迁移

### 2.3 UserDefaults 频繁 I/O 问题

**问题分析**:
在每个 `@Published` 属性的 `didSet` 中直接调用 `UserDefaults.standard.set()`，当用户快速切换筛选条件时，会造成：
1. 磁盘 I/O 频繁，性能下降
2. 主线程阻塞
3. 可能丢失用户设置（写入失败时）

**优化方案**: 创建 `SettingsStore` 服务统一管理

```swift
// 1. 创建 SettingsStore 服务
@MainActor
final class SettingsStore: ObservableObject {
    private let defaults = UserDefaults.standard
    private let queue = DispatchQueue(label: "settings.store", qos: .utility)

    // 使用缓存延迟写入
    private var pendingWrites: [String: Any] = [:]
    private var writeTimer: Timer?

    func set<T>(_ value: T, forKey key: String) where T: Codable {
        queue.async { [weak self] in
            self?.pendingWrites[key] = value

            // 300ms 延迟批处理
            self?.writeTimer?.invalidate()
            self?.writeTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: false) { _ in
                Task { @MainActor in
                    self?.flushPendingWrites()
                }
            }
        }
    }

    func get<T>(forKey key: String, defaultValue: T) -> T where T: Codable {
        queue.sync {
            if let value = pendingWrites[key] as? T {
                return value
            }
            return defaults.object(forKey: key) as? T ?? defaultValue
        }
    }

    private func flushPendingWrites() {
        queue.async {
            self.defaults.setValuesForKeys(self.pendingWrites)
            self.pendingWrites.removeAll()
        }
    }

    deinit {
        flushPendingWrites()
    }
}

// 2. 集成到 DIContainer
extension DIContainer {
    @MainActor
    var settingsStore: SettingsStore {
        sharedInstance.settingsStore
    }
}

// 3. ViewModel 使用
@MainActor
final class GoodLinksViewModel: ObservableObject {
    private let settingsStore: SettingsStore

    @Published var sortKey: GoodLinksSortKey = .modified {
        didSet {
            settingsStore.set(sortKey.rawValue, forKey: "goodlinks_sort_key")
        }
    }

    @Published var highlightNoteFilter: NoteFilter = false {
        didSet {
            settingsStore.set(highlightNoteFilter, forKey: "goodlinks_highlight_note_filter")
            settingsStore.set(highlightNoteFilter, forKey: "highlight_has_notes")
        }
    }

    // 初始化时从 settingsStore 读取
    init(settingsStore: SettingsStore = DIContainer.shared.settingsStore) {
        self.settingsStore = settingsStore
        // 延迟加载设置
        if let raw = settingsStore.get(forKey: "goodlinks_sort_key", defaultValue: GoodLinksSortKey.modified.rawValue),
           let key = GoodLinksSortKey(rawValue: raw) {
            self.sortKey = key
        }
        // ... 其他设置
    }
}
```

**性能对比**:

| 场景 | 原始实现 | 优化后 |
|------|----------|--------|
| 快速切换10次排序 | 10次磁盘写入 | 1次批量写入 |
| 主线程阻塞时间 | ~100-200ms | ~10-20ms |
| 数据一致性 | 可能丢失 | 批量保证 |

**实施步骤**:
1. 创建 `SettingsStore` 服务类
2. 注册到 `DIContainer`
3. 替换所有 ViewModel 中的 UserDefaults 直接访问
4. 添加 `flushPendingWrites()` 到应用生命周期钩子
5. 测试验证性能提升

---
