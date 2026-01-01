# Chats 同步到 Notion 功能完善计划

> **创建日期**：2026-01-01
> **完成日期**：2026-01-01
> **状态**：✅ 已完成（P1 + P2）

## 1. 当前实现状态分析

### 1.1 已完成 ✅

| 模块 | 文件 | 状态 |
|------|------|------|
| **数据模型** | | |
| `HighlightSource.chats` | `Models/Core/HighlightColorScheme.swift` | ✅ |
| `SyncSource.chats` | `Models/Sync/SyncQueueModels.swift` | ✅ |
| `ContentSource.chats` | `Models/Core/Models.swift` | ✅ |
| `UnifiedHighlight.init(from:contactName:)` | `Models/Core/UnifiedHighlight.swift` | ✅ |
| `UnifiedSyncItem.init(from: ChatBookListItem)` | `Models/Core/UnifiedHighlight.swift` | ✅ |
| **同步适配器** | | |
| `ChatsNotionAdapter` | `Services/DataSources-To/Notion/SyncEngine/Adapters/ChatsNotionAdapter.swift` | ✅ |
| **ViewModel** | | |
| `ChatViewModel.syncConversation()` | `ViewModels/Chats/ChatViewModel.swift` | ✅ |
| `ChatViewModel.batchSync()` | `ViewModels/Chats/ChatViewModel.swift` | ✅ |
| `ChatViewModel.getLastSyncTime()` | `ViewModels/Chats/ChatViewModel.swift` | ✅ |
| **Views** | | |
| `ChatListView` (含焦点管理) | `Views/Chats/ChatListView.swift` | ✅ |
| `ChatDetailView` (含 onScrollViewResolved) | `Views/Chats/ChatDetailView.swift` | ✅ |
| 同步按钮和进度显示 | `Views/Chats/ChatDetailView.swift` | ✅ |
| **MainListView 集成** | | |
| `chatsSourceEnabled` AppStorage | `MainListView.swift` | ✅ |
| `selectedChatsContactIds` State | `MainListView.swift` | ✅ |
| `chatsVM` StateObject | `MainListView.swift` | ✅ |
| `chatsDetailView` | `MainListView+DetailViews.swift` | ✅ |
| `syncSelectedChats()` | `MainListView+DetailViews.swift` | ✅ |
| `chatsFilterMenu` | `MainListView+FilterMenus.swift` | ✅ |
| 键盘导航支持 | `MainListView+KeyboardMonitor.swift` | ✅ |
| **Settings** | | |
| Chats 设置入口 | `SettingsView.swift` | ✅ |
| `OCRSettingsView` | `Views/Settings/SyncFrom/OCRSettingsView.swift` | ✅ |

### 1.2 已修复 ✅

| 问题 | 优先级 | 文件 | 状态 |
|------|--------|------|------|
| `SyncQueueTaskSelected` 通知不处理 Chats | P1 | `MainListView.swift` | ✅ 已修复 |
| 切换数据源时 `selectedChatsContactIds` 未清空 | P1 | `MainListView.swift` | ✅ 已修复 |

### 1.3 已实现 ✅

| 功能 | 优先级 | 所需文件 | 状态 |
|------|--------|----------|------|
| `ChatsAutoSyncProvider` | P2 | `Services/SyncScheduling/ChatsAutoSyncProvider.swift` | ✅ 已创建 |
| `AutoSyncService` 添加 Chats provider | P2 | `Services/SyncScheduling/AutoSyncService.swift` | ✅ 已更新 |
| `AutoSyncServiceProtocol` 添加 `triggerChatsNow()` | P2 | `Services/Core/Protocols.swift` | ✅ 已更新 |
| Chats 排序筛选菜单完善（可选） | P3 | `MainListView+FilterMenus.swift` | ⏳ 暂不实现 |

---

## 2. 实施计划

### P1: 关键 Bug 修复（必须）

#### P1-1: 修复 `SyncQueueTaskSelected` 通知不处理 Chats

**问题描述**：
在同步队列视图点击 Chats 任务时，无法跳转到对应的对话。

**文件**：`SyncNos/Views/Components/Main/MainListView.swift`

**修改位置**：第 226-252 行的 `onReceive(SyncQueueTaskSelected)` 处理

**修改内容**：
添加 Chats case：
```swift
} else if source == ContentSource.chats.rawValue {
    contentSourceRawValue = ContentSource.chats.rawValue
    selectedBookIds.removeAll()
    selectedLinkIds.removeAll()
    selectedWeReadBookIds.removeAll()
    selectedDedaoBookIds.removeAll()
    selectedChatsContactIds = Set([id])
}
```

#### P1-2: 修复切换数据源时 `selectedChatsContactIds` 未清空

**问题描述**：
切换数据源时，Chats 的选中状态没有被清空，可能导致状态不一致。

**文件**：`SyncNos/Views/Components/Main/MainListView.swift`

**修改位置**：第 217-225 行的 `onChange(of: contentSourceRawValue)` 处理

**修改内容**：
在清除其他选中状态的地方添加：
```swift
selectedChatsContactIds.removeAll()
```

---

### P2: AutoSync 自动同步支持（推荐）

#### P2-1: 创建 `ChatsAutoSyncProvider`

**文件**：新建 `SyncNos/Services/SyncScheduling/ChatsAutoSyncProvider.swift`

**参考**：`WeReadAutoSyncProvider.swift` 和 `DedaoAutoSyncProvider.swift`

**核心实现**：
```swift
import Foundation

final class ChatsAutoSyncProvider: AutoSyncSourceProvider {
    let sourceKey: String = "chats"
    
    private let logger: LoggerServiceProtocol
    
    var isEnabled: Bool {
        UserDefaults.standard.bool(forKey: "autoSync.chats")
    }
    
    init(logger: LoggerServiceProtocol = DIContainer.shared.loggerService) {
        self.logger = logger
    }
    
    func detectChanges() async throws -> Bool {
        // Chats 的变化检测：比较本地缓存的消息更新时间
        // 暂时返回 false，因为 Chats 的变化来源于用户导入截图，不像其他数据源有外部变化
        return false
    }
    
    func performSync() async throws {
        // Chats 自动同步逻辑
        // 考虑到 Chats 数据完全由用户本地管理（导入截图），自动同步可能不太适用
        // 但可以实现"自动同步所有未同步过的对话"的逻辑
    }
    
    func triggerScheduledSyncIfEnabled() {
        guard isEnabled else { return }
        logger.info("[SmartSync] Chats scheduled sync triggered (skipped - manual sync only)")
        // Chats 目前设计为手动同步，不执行自动同步
    }
    
    func triggerManualSyncNow() {
        logger.info("[SmartSync] Chats manual sync triggered")
        // 触发所有未同步对话的同步（可选实现）
    }
}
```

#### P2-2: 更新 `AutoSyncService`

**文件**：`SyncNos/Services/SyncScheduling/AutoSyncService.swift`

**修改内容**：

1. 在 `init` 中添加 ChatsAutoSyncProvider：
```swift
let chats = ChatsAutoSyncProvider(logger: logger)
self.providers = [
    .appleBooks: apple,
    .goodLinks: goodLinks,
    .weRead: weRead,
    .dedao: dedao,
    .chats: chats  // 新增
]
```

2. 添加 `triggerChatsNow()` 方法：
```swift
func triggerChatsNow() {
    providers[.chats]?.triggerManualSyncNow()
}
```

#### P2-3: 更新 `AutoSyncServiceProtocol`

**文件**：`SyncNos/Services/Core/Protocols.swift`

**修改内容**：
在 `AutoSyncServiceProtocol` 中添加：
```swift
func triggerChatsNow()
```

---

### P3: 可选增强（低优先级）

#### P3-1: 完善 Chats 筛选排序菜单

**文件**：`SyncNos/Views/Components/Main/MainListView+FilterMenus.swift`

**当前状态**：只有 "New Chat" 按钮

**可添加的功能**：
- 按名称排序
- 按消息数量排序
- 按最后同步时间排序

**注意**：这需要在 `ChatViewModel` 中添加相应的排序属性和逻辑。由于 Chats 的特殊性（数量通常较少，用户手动管理），此功能优先级较低。

---

## 3. 验证清单

### P1 验证 ✅
- [x] 在同步队列中点击 Chats 任务，能正确跳转到对应对话
- [x] 切换到其他数据源后再切回 Chats，选中状态正确重置
- [x] 编译无错误，运行无崩溃

### P2 验证 ✅
- [x] `ChatsAutoSyncProvider` 正确初始化
- [x] `AutoSyncService` 包含 Chats provider
- [x] 调用 `triggerChatsNow()` 不报错（即使是空实现）
- [x] 编译无错误

### P3 验证（暂不实现）
- [ ] 排序菜单正确显示（如果实现）
- [ ] 排序功能正常工作（如果实现）

---

## 4. 文件修改汇总

### 需要修改的文件

| 文件 | 修改内容 | 优先级 |
|------|----------|--------|
| `Views/Components/Main/MainListView.swift` | 添加 Chats case 到 SyncQueueTaskSelected 处理；清空 selectedChatsContactIds | P1 |
| `Services/SyncScheduling/AutoSyncService.swift` | 添加 ChatsAutoSyncProvider；添加 triggerChatsNow() | P2 |
| `Services/Core/Protocols.swift` | 在 AutoSyncServiceProtocol 中添加 triggerChatsNow() | P2 |

### 需要新建的文件

| 文件 | 说明 | 优先级 |
|------|------|--------|
| `Services/SyncScheduling/ChatsAutoSyncProvider.swift` | Chats 自动同步 Provider | P2 |

---

## 5. 实施顺序

1. **P1-1**: 修复 SyncQueueTaskSelected 通知
2. **P1-2**: 修复 selectedChatsContactIds 清空问题
3. **验证 P1**: 构建并测试
4. **P2-3**: 更新 Protocols.swift
5. **P2-1**: 创建 ChatsAutoSyncProvider
6. **P2-2**: 更新 AutoSyncService
7. **验证 P2**: 构建并测试
8. (可选) **P3**: 完善筛选排序菜单

---

## 6. 注意事项

### Chats 的特殊性

与其他数据源（Apple Books、GoodLinks、WeRead、Dedao）不同，Chats 数据：
- **完全由用户本地管理**：数据来源于用户导入的截图，而非外部应用/服务
- **无外部变化源**：不像其他数据源可能有外部更新
- **适合手动同步**：用户在编辑完消息分类后手动触发同步更合理

因此，`ChatsAutoSyncProvider` 的实现可以是"空操作"或"仅同步未同步过的对话"，而非像其他数据源那样检测变化并自动同步。

### 未来扩展

根据技术文档 `Chats-Notion-Sync-TechDoc.md` 的"未来扩展"部分：
- [ ] 支持 PerBook 模式（每个对话独立数据库）
- [ ] 支持图片消息同步
- [ ] 支持自动同步（Smart Sync）
- [ ] 支持双向同步

当前 P2 阶段的 AutoSync 实现为这些未来扩展打下基础，但不强制启用自动同步功能。

