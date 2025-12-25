# Apple Shortcuts 集成实现计划

> **状态**：⏸️ 尚未开始（2024-12-24）  
> **优先级**：中（可作为后续迭代的功能增强）

## 概述

通过 **App Intents** 框架，让 SyncNos 的核心功能可以被 Apple Shortcuts 应用调用，实现自动化工作流。

**目标**：让用户可以通过 Shortcuts 应用创建自动化流程，如定时同步、一键同步、获取高亮等。

**预计工作量**：2-3 天

---

## 一、功能规划

### 1.1 第一阶段：基础动作（必须实现）

| Intent | 说明 | 参数 | 返回值 |
|--------|------|------|--------|
| `SyncAllBooksIntent` | 同步所有启用数据源的书籍 | 无 | 成功/失败状态 |
| `GetSyncStatusIntent` | 获取当前同步状态 | 无 | 队列中/运行中/失败的任务数 |
| `OpenSyncNosIntent` | 打开 SyncNos 主窗口 | 无 | 无 |

### 1.2 第二阶段：参数化动作（推荐实现）

| Intent | 说明 | 参数 | 返回值 |
|--------|------|------|--------|
| `SyncDataSourceIntent` | 同步指定数据源 | 数据源类型 | 成功/失败状态 |
| `GetRecentHighlightsIntent` | 获取最近的高亮 | 数量、数据源（可选） | 高亮文本列表 |
| `SearchHighlightsIntent` | 搜索高亮 | 关键词、数据源（可选） | 匹配的高亮列表 |

### 1.3 第三阶段：高级动作（可选实现）

| Intent | 说明 | 参数 | 返回值 |
|--------|------|------|--------|
| `ExportHighlightsIntent` | 导出高亮 | 格式、数据源、书名 | 文件路径或文本 |
| `GetBookListIntent` | 获取书籍列表 | 数据源 | 书籍标题列表 |
| `SyncSpecificBookIntent` | 同步指定书籍 | 书名、数据源 | 成功/失败状态 |

---

## 二、技术架构

### 2.1 文件结构

```
SyncNos/
├── Intents/                          # App Intents 模块
│   ├── SyncIntents/                  # 同步相关 Intents
│   │   ├── SyncAllBooksIntent.swift
│   │   ├── SyncDataSourceIntent.swift
│   │   └── SyncSpecificBookIntent.swift
│   ├── QueryIntents/                 # 查询相关 Intents
│   │   ├── GetSyncStatusIntent.swift
│   │   ├── GetRecentHighlightsIntent.swift
│   │   ├── SearchHighlightsIntent.swift
│   │   └── GetBookListIntent.swift
│   ├── ExportIntents/                # 导出相关 Intents
│   │   └── ExportHighlightsIntent.swift
│   ├── AppShortcuts.swift            # App Shortcuts 定义（Siri 建议）
│   └── IntentEntities/               # Intent 实体定义
│       ├── DataSourceEntity.swift    # 数据源实体
│       ├── BookEntity.swift          # 书籍实体
│       └── HighlightEntity.swift     # 高亮实体
└── Info.plist                        # 添加 Intents 声明
```

### 2.2 核心依赖

```swift
import AppIntents
```

### 2.3 实体定义

#### DataSourceEntity（数据源实体）

```swift
struct DataSourceEntity: AppEntity {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Data Source")
    static var defaultQuery = DataSourceQuery()
    
    var id: String
    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }
    
    let name: String
    let icon: String
    
    static let appleBooks = DataSourceEntity(id: "appleBooks", name: "Apple Books", icon: "book")
    static let goodLinks = DataSourceEntity(id: "goodLinks", name: "GoodLinks", icon: "bookmark")
    static let weRead = DataSourceEntity(id: "weRead", name: "WeRead", icon: "text.book.closed")
    static let dedao = DataSourceEntity(id: "dedao", name: "Dedao", icon: "book.closed")
}

struct DataSourceQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [DataSourceEntity] {
        identifiers.compactMap { id in
            switch id {
            case "appleBooks": return .appleBooks
            case "goodLinks": return .goodLinks
            case "weRead": return .weRead
            case "dedao": return .dedao
            default: return nil
            }
        }
    }
    
    func suggestedEntities() async throws -> [DataSourceEntity] {
        [.appleBooks, .goodLinks, .weRead, .dedao]
    }
}
```

#### HighlightEntity（高亮实体）

```swift
struct HighlightEntity: AppEntity, Identifiable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Highlight")
    static var defaultQuery = HighlightQuery()
    
    var id: String
    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(text.prefix(50))...")
    }
    
    let text: String
    let note: String?
    let bookTitle: String
    let source: String
    let createdAt: Date?
}
```

---

## 三、Intent 实现详情

### 3.1 SyncAllBooksIntent

```swift
import AppIntents

struct SyncAllBooksIntent: AppIntent {
    static var title: LocalizedStringResource = "Sync All Books"
    static var description = IntentDescription("Sync all highlights from all enabled data sources to Notion")
    
    static var openAppWhenRun: Bool = false
    
    func perform() async throws -> some IntentResult & ProvidesDialog {
        // 检查 Notion 配置
        guard DIContainer.shared.notionConfigStore.isConfigured else {
            return .result(dialog: "Notion is not configured. Please open SyncNos and configure Notion first.")
        }
        
        // 触发同步
        let autoSyncService = DIContainer.shared.autoSyncService
        
        // 触发所有启用的数据源同步
        autoSyncService.triggerAppleBooksNow()
        autoSyncService.triggerGoodLinksNow()
        // ... 其他数据源
        
        return .result(dialog: "Started syncing all books to Notion.")
    }
}
```

### 3.2 GetSyncStatusIntent

```swift
struct GetSyncStatusIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Sync Status"
    static var description = IntentDescription("Get the current sync queue status")
    
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let store = DIContainer.shared.syncQueueStore
        let tasks = store.snapshot
        
        let running = tasks.filter { $0.state == .running }.count
        let queued = tasks.filter { $0.state == .queued }.count
        let failed = tasks.filter { $0.state == .failed }.count
        
        let status = """
        Running: \(running)
        Queued: \(queued)
        Failed: \(failed)
        """
        
        return .result(value: status)
    }
}
```

### 3.3 SyncDataSourceIntent

```swift
struct SyncDataSourceIntent: AppIntent {
    static var title: LocalizedStringResource = "Sync Data Source"
    static var description = IntentDescription("Sync highlights from a specific data source")
    
    @Parameter(title: "Data Source")
    var dataSource: DataSourceEntity
    
    static var parameterSummary: some ParameterSummary {
        Summary("Sync \(\.$dataSource)")
    }
    
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard DIContainer.shared.notionConfigStore.isConfigured else {
            return .result(dialog: "Notion is not configured.")
        }
        
        let autoSyncService = DIContainer.shared.autoSyncService
        
        switch dataSource.id {
        case "appleBooks":
            autoSyncService.triggerAppleBooksNow()
        case "goodLinks":
            autoSyncService.triggerGoodLinksNow()
        case "weRead":
            autoSyncService.triggerWeReadNow()
        case "dedao":
            autoSyncService.triggerDedaoNow()
        default:
            return .result(dialog: "Unknown data source.")
        }
        
        return .result(dialog: "Started syncing \(dataSource.name).")
    }
}
```

### 3.4 GetRecentHighlightsIntent

```swift
struct GetRecentHighlightsIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Recent Highlights"
    static var description = IntentDescription("Get the most recent highlights")
    
    @Parameter(title: "Count", default: 10)
    var count: Int
    
    @Parameter(title: "Data Source", default: nil)
    var dataSource: DataSourceEntity?
    
    static var parameterSummary: some ParameterSummary {
        Summary("Get \(\.$count) recent highlights") {
            \.$dataSource
        }
    }
    
    func perform() async throws -> some IntentResult & ReturnsValue<[String]> {
        // 从各数据源获取最近的高亮
        var highlights: [String] = []
        
        // TODO: 实现从缓存或数据库获取高亮的逻辑
        // 这需要一个统一的高亮查询服务
        
        return .result(value: highlights)
    }
}
```

### 3.5 SearchHighlightsIntent

```swift
struct SearchHighlightsIntent: AppIntent {
    static var title: LocalizedStringResource = "Search Highlights"
    static var description = IntentDescription("Search for highlights by keyword")
    
    @Parameter(title: "Keyword")
    var keyword: String
    
    @Parameter(title: "Data Source", default: nil)
    var dataSource: DataSourceEntity?
    
    static var parameterSummary: some ParameterSummary {
        Summary("Search for \(\.$keyword)") {
            \.$dataSource
        }
    }
    
    func perform() async throws -> some IntentResult & ReturnsValue<[String]> {
        // TODO: 实现搜索逻辑
        return .result(value: [])
    }
}
```

---

## 四、App Shortcuts（Siri 建议）

```swift
import AppIntents

struct SyncNosShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: SyncAllBooksIntent(),
            phrases: [
                "Sync all books in \(.applicationName)",
                "Sync highlights with \(.applicationName)",
                "Update \(.applicationName)"
            ],
            shortTitle: "Sync All Books",
            systemImageName: "arrow.triangle.2.circlepath"
        )
        
        AppShortcut(
            intent: GetSyncStatusIntent(),
            phrases: [
                "Get sync status in \(.applicationName)",
                "Check \(.applicationName) status"
            ],
            shortTitle: "Get Sync Status",
            systemImageName: "info.circle"
        )
        
        AppShortcut(
            intent: GetRecentHighlightsIntent(),
            phrases: [
                "Get recent highlights from \(.applicationName)",
                "Show my highlights in \(.applicationName)"
            ],
            shortTitle: "Get Recent Highlights",
            systemImageName: "highlighter"
        )
    }
}
```

---

## 五、实现步骤

### 第一步：基础设置（0.5 天）

1. 创建 `Intents/` 目录结构
2. 添加 `AppIntents` 框架
3. 实现 `DataSourceEntity` 实体
4. 实现 `SyncAllBooksIntent`
5. 实现 `GetSyncStatusIntent`
6. 实现 `OpenSyncNosIntent`

### 第二步：参数化动作（1 天）

1. 实现 `SyncDataSourceIntent`
2. 创建统一的高亮查询服务（跨数据源）
3. 实现 `GetRecentHighlightsIntent`
4. 实现 `SearchHighlightsIntent`

### 第三步：App Shortcuts 和测试（0.5 天）

1. 实现 `SyncNosShortcuts`
2. 测试所有 Intents
3. 添加本地化字符串
4. 更新文档

### 第四步：高级功能（可选，1 天）

1. 实现 `ExportHighlightsIntent`
2. 实现 `GetBookListIntent`
3. 实现 `SyncSpecificBookIntent`
4. 实现 `BookEntity` 和 `HighlightEntity`

---

## 六、前置依赖

### 6.1 需要先实现的服务

1. **统一高亮查询服务**：用于跨数据源查询高亮
   - 目前各数据源的高亮存储在不同的地方（SQLite、SwiftData 缓存）
   - 需要一个统一的查询接口

2. **AutoSyncService 扩展**：添加 `triggerWeReadNow()` 和 `triggerDedaoNow()` 方法

### 6.2 可选依赖

- 全局搜索功能（如果要实现 `SearchHighlightsIntent`）
- 导出功能（如果要实现 `ExportHighlightsIntent`）

---

## 七、测试计划

### 7.1 单元测试

- 测试每个 Intent 的 `perform()` 方法
- 测试实体查询

### 7.2 集成测试

- 在 Shortcuts 应用中创建工作流
- 测试参数传递
- 测试错误处理

### 7.3 用户场景测试

| 场景 | 步骤 |
|------|------|
| 定时同步 | 创建每天 8 点触发 `SyncAllBooksIntent` 的自动化 |
| 一键同步 | 在主屏幕添加 "Sync All Books" 快捷方式 |
| 每日回顾 | 获取最近 10 条高亮 + 发送到 Notes |

---

## 八、风险和注意事项

1. **后台执行限制**：App Intents 在后台执行时有时间限制，长时间同步可能被中断
2. **数据访问**：需要确保在后台也能访问数据库和缓存
3. **错误处理**：需要优雅地处理各种错误情况（未配置、网络错误等）
4. **本地化**：所有 Intent 标题和描述都需要本地化

---

## 九、参考资料

- [App Intents 官方文档](https://developer.apple.com/documentation/appintents)
- [WWDC22: Dive into App Intents](https://developer.apple.com/videos/play/wwdc2022/10032/)
- [WWDC23: Explore enhancements to App Intents](https://developer.apple.com/videos/play/wwdc2023/10103/)

---

## 十、版本历史

| 版本 | 日期 | 修改内容 |
|------|------|----------|
| 1.0 | 2024-12-08 | 初始版本 |

