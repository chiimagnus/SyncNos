# Apple Books 笔记数据获取技术文档

## 概述

SyncBookNotesWithNotion 是一款用于同步 Apple Books 笔记数据到 Notion 的 macOS 应用程序。本文档详细说明了该应用如何获取和处理 Apple Books 的笔记数据。

## 数据存储结构

### Apple Books 数据位置

Apple Books 将用户数据存储在以下位置：
```
~/Library/Containers/com.apple.iBooksX/Data/Documents/
├── AEAnnotation/          # 笔记和高亮数据
│   └── *.sqlite          # 数据库文件（动态命名）
└── BKLibrary/            # 书籍信息数据
    └── *.sqlite          # 数据库文件（动态命名）
```

### 数据库结构

应用程序使用两个 SQLite 数据库：

1. **AEAnnotation 数据库**
   - 存储所有笔记和高亮数据
   - 主要表：`ZAEANNOTATION`

2. **BKLibrary 数据库**
   - 存储书籍元数据
   - 主要表：`ZBKLIBRARYASSET`

## 权限和访问机制

### 安全作用域访问

由于 Apple Books 数据存储在沙盒容器中，应用程序需要特殊的权限访问：

1. **用户目录选择**
   - 使用 `NSOpenPanel` 让用户手动选择 Apple Books 容器目录
   - 默认路径：`~/Library/Containers/com.apple.iBooksX`
   - 支持智能路径识别（自动导航到 Data/Documents）

2. **安全书签持久化**
   - 使用 `URL.bookmarkData()` 创建安全作用域书签
   - 通过 `UserDefaults` 存储书签数据
   - 启动时自动恢复访问权限

### 关键代码实现

```swift
// AppleBooksPicker.swift
public static func pickAppleBooksContainer() {
    let panel = NSOpenPanel()
    panel.canChooseFiles = false
    panel.canChooseDirectories = true
    // ... 配置面板

    panel.begin { response in
        guard response == .OK, let url = panel.url else { return }
        // 持久化安全书签
        BookmarkStore.shared.save(folderURL: url)
        _ = BookmarkStore.shared.startAccessing(url: url)
        // 通知其他组件
    }
}
```

## 数据库连接和查询

### 数据库连接服务

应用程序采用分层架构设计：

1. **DatabaseConnectionService**: 处理数据库连接
2. **DatabaseQueryService**: 处理 SQL 查询逻辑
3. **DatabaseService**: 整合连接和查询服务

#### 只读访问模式

```swift
// DatabaseConnectionService.swift
func openReadOnlyDatabase(dbPath: String) throws -> OpaquePointer {
    var db: OpaquePointer?
    let rc = sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil)
    // ... 错误处理
    return handle
}
```

### 数据查询策略

#### 动态表结构适配

Apple Books 数据库结构可能因版本而异，应用程序使用动态查询：

```swift
// DatabaseQueryService.swift
func fetchAnnotations(db: OpaquePointer) throws -> [HighlightRow] {
    // 1. 首先检查表结构
    let tableInfoSQL = "PRAGMA table_info('ZAEANNOTATION');"
    // 2. 动态构建查询语句，只包含存在的列
    var availableColumns: Set<String> = []
    // 3. 构建兼容的 SELECT 语句
    let sql = "SELECT \(selectColumns.joined(separator: ",")) FROM ZAEANNOTATION WHERE ZANNOTATIONDELETED=0 AND ZANNOTATIONSELECTEDTEXT NOT NULL;"
}
```

#### 支持的数据字段

**ZAEANNOTATION 表字段映射：**
- `ZANNOTATIONASSETID`: 书籍资产ID
- `ZANNOTATIONUUID`: 笔记唯一标识
- `ZANNOTATIONSELECTEDTEXT`: 高亮文本内容
- `ZANNOTATIONNOTE`: 用户添加的笔记（可选）
- `ZANNOTATIONSTYLE`: 高亮样式（可选）
- `ZANNOTATIONCREATIONDATE`: 创建时间（可选）
- `ZANNOTATIONMODIFICATIONDATE`: 修改时间（可选）
- `ZANNOTATIONLOCATION`: 位置信息（可选）

### 性能优化策略

#### 分页加载

对于大量笔记数据，采用分页查询避免内存溢出：

```swift
// DatabaseQueryService.swift
func fetchHighlightPage(db: OpaquePointer, assetId: String, limit: Int, offset: Int) throws -> [HighlightRow] {
    let sql = "SELECT ... FROM ZAEANNOTATION WHERE ... ORDER BY ZANNOTATIONCREATIONDATE DESC LIMIT ? OFFSET ?;"
    // 每次查询限制数量，默认 50 条
}
```

#### 聚合查询优化

书籍列表显示时，先查询每本书的笔记数量：

```swift
// 获取每本书的笔记统计
let sql = "SELECT ZANNOTATIONASSETID, COUNT(*) FROM ZAEANNOTATION WHERE ZANNOTATIONDELETED=0 AND ZANNOTATIONSELECTEDTEXT NOT NULL GROUP BY ZANNOTATIONASSETID;"

// 然后批量查询书籍信息
let placeholders = Array(repeating: "?", count: assetIds.count).joined(separator: ",")
let sql = "SELECT ZASSETID, ZAUTHOR, ZTITLE FROM ZBKLIBRARYASSET WHERE ZASSETID IN (\(placeholders));"
```

## 数据模型

### 核心数据结构

```swift
// Models.swift

/// 原始查询结果 - 高亮/笔记行
struct HighlightRow {
    let assetId: String      // 书籍ID
    let uuid: String         // 笔记UUID
    let text: String         // 高亮文本
    let note: String?        // 用户笔记
    let style: Int?          // 高亮样式
    let dateAdded: Date?     // 创建时间
    let modified: Date?      // 修改时间
    let location: String?    // 位置信息
}

/// 原始查询结果 - 书籍行
struct BookRow {
    let assetId: String      // 书籍ID
    let author: String       // 作者
    let title: String        // 书名
}

/// 用于UI展示的书籍列表项
struct BookListItem: Codable {
    let bookId: String
    let authorName: String
    let bookTitle: String
    let ibooksURL: String
    let highlightCount: Int
}
```

## 数据流和处理流程

### 1. 路径确定和数据库发现

```swift
// BookViewModel.swift
func determineDatabaseRoot(from selectedPath: String) -> String {
    // 智能识别用户选择的路径
    // 支持多种选择方式：
    // - 直接选择容器目录
    // - 选择 Data/Documents
    // - 选择 Data
    // - 选择容器根目录
}

private func latestSQLiteFile(in dir: String) -> String? {
    // 查找最新的 SQLite 文件
    // Apple Books 可能有多个版本的数据库文件
}
```

### 2. 书籍列表加载

```
用户选择路径 → 发现数据库文件 → 打开数据库连接 → 查询统计数据 → 获取书籍信息 → 构建UI模型
```

### 3. 书籍详情加载

```
选择书籍 → 分页查询笔记 → 转换数据模型 → 更新UI
```

## 错误处理和兼容性

### 数据库版本兼容性

- 使用 `PRAGMA table_info()` 动态检查表结构
- 可选字段处理：检查列是否存在再查询
- 降级策略：缺少某些字段时使用默认值

### 权限错误处理

- 书签过期时自动刷新
- 路径不存在时提供清晰错误信息
- 数据库文件损坏时的恢复提示

### 数据验证

- 过滤空文本的笔记
- 验证必需字段的存在性
- 处理 NULL 值和数据类型转换

## 性能考虑

### 内存管理

- 不一次性加载所有数据到内存
- 使用分页加载大量笔记
- 及时关闭数据库连接

### 查询优化

- 使用索引字段进行查询
- 批量查询书籍信息
- 避免重复查询相同数据

### UI响应性

- 后台线程执行数据库操作
- 主线程更新UI
- 加载状态指示器

## 安全和隐私

### 数据访问限制

- 只读访问模式，绝不修改原始数据
- 沙盒权限控制
- 用户明确授权访问

### 数据处理原则

- 本地处理，不上传原始数据
- 仅同步用户选择的笔记内容
- 尊重用户隐私设置

## 总结

SyncBookNotesWithNotion 通过精心设计的架构实现了高效、安全的 Apple Books 笔记数据获取：

1. **权限管理**：使用安全作用域书签持久化访问权限
2. **数据库访问**：原生 SQLite 只读访问，性能优异
3. **动态适配**：自动适应不同版本的数据库结构
4. **性能优化**：分页加载和聚合查询优化
5. **错误处理**：完善的异常处理和用户提示
6. **隐私保护**：严格的数据访问控制和处理原则

这种设计既保证了数据的完整性和安全性，又提供了优秀的用户体验。
