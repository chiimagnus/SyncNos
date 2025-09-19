# Apple Books 数据访问说明（简要）

本文件简要说明 SyncNos 项目如何定位并解析 Apple Books（在 macOS 上）保存的笔记/高亮数据，便于其他开发者理解和维护。

- **定位容器与所需目录**
  - 用户通过界面触发 `AppleBooksPicker.pickAppleBooksContainer()` 选择 Apple Books 容器或其 `Data/Documents` 路径。
  - 选择后会保存安全范围书签（`BookmarkStore`），并触发通知 `AppleBooksContainerSelected`，ViewModel 使用该路径作为 `dbRootOverride`。

- **Apple Books 数据目录**
  - 目标根目录（`dbRoot`）通常为：
    - `~/Library/Containers/com.apple.iBooksX/Data/Documents`
  - 项目中查找的两个子目录：
    - `AEAnnotation`（存储注释/高亮，annotation DB）
    - `BKLibrary`（存储图书元数据，books DB）
  - 代码通过 `BookViewModel.determineDatabaseRoot(from:)` 自动推断用户选择的位置，并通过 `DatabaseService.latestSQLiteFile(in:)` 选取子目录中最新的 `.sqlite` 文件作为数据库文件路径。

- **打开数据库**
  - 使用 `DatabaseConnectionService.openReadOnlyDatabase(dbPath:)` 以只读模式打开 SQLite 文件（`sqlite3_open_v2` + `SQLITE_OPEN_READONLY`），并在读取完成后关闭连接。
  - 不复制数据库文件，直接以只读方式打开用户提供的原始文件路径。

- **主要表与字段（项目中使用）**
  - 注释/高亮表：`ZAEANNOTATION`（项目代码假定该表存在）
    - 必要字段（强制读取）
      - `ZANNOTATIONASSETID`：关联书籍的 assetId（用于将高亮聚合到书籍）
      - `ZANNOTATIONUUID`：每条高亮的唯一 UUID
      - `ZANNOTATIONSELECTEDTEXT`：高亮的文本内容（selected text）
    - 可选字段（按表结构动态检测后读取）
      - `ZANNOTATIONNOTE`：高亮附加的备注文本
      - `ZANNOTATIONSTYLE`：样式/颜色等整数编码
      - `ZANNOTATIONCREATIONDATE`：创建时间（以 `TimeInterval` 存为 reference date）
      - `ZANNOTATIONMODIFICATIONDATE`：修改时间（以 `TimeInterval` 存为 reference date）
      - `ZANNOTATIONLOCATION`：位置信息（字符串）
    - 过滤条件：`ZANNOTATIONDELETED=0` 且 `ZANNOTATIONSELECTEDTEXT NOT NULL`（只取未删除且有文本的记录）。

  - 图书元数据表：`ZBKLIBRARYASSET`
    - 读取字段：
      - `ZASSETID`：与注释表的 `ZANNOTATIONASSETID` 对应
      - `ZAUTHOR`：作者
      - `ZTITLE`：书名

- **查询策略**
  - 先使用 `PRAGMA table_info('ZAEANNOTATION')` 动态检测表中可用的列名，避免在不同 iBooks 版本/本地化下硬编码全部列，确保向后/向前兼容性。
  - 构建 `SELECT` 语句：始终包含三列（assetId, uuid, selectedText），并仅在 `PRAGMA` 检查到列存在时才将可选列加入 `SELECT`。
  - 对注释读取有三种用途：
    1. `fetchHighlightCountsByAsset`：按 `ZANNOTATIONASSETID` 聚合计数（用于在列表中显示每本书的高亮数），SQL 示例如：
       SELECT ZANNOTATIONASSETID, COUNT(*) FROM ZAEANNOTATION WHERE ZANNOTATIONDELETED=0 AND ZANNOTATIONSELECTEDTEXT NOT NULL GROUP BY ZANNOTATIONASSETID;
    2. `fetchAnnotations`：读取所有高亮记录（MVP 版本，带基本过滤），会返回 `HighlightRow` 列表。
    3. `fetchHighlightPage`：基于 `assetId` 的分页读取，使用 `LIMIT` / `OFFSET` 以及优先使用 `ZANNOTATIONCREATIONDATE DESC` 排序，若不存在该列则回退到 `rowid DESC`。
  - 读取日期字段时，代码将数据库中 double 值按 `TimeInterval` 作为 `Date(timeIntervalSinceReferenceDate:)` 来解析（注意：这是 Foundation 的 reference date 处理方式）。

- **数据模型映射**
  - 本地内部类型：`HighlightRow`、`BookRow` 用于数据库层与 ViewModel 之间传递；`Highlight`、`BookExport` 用于导出/序列化。
  - 在构建导出对象时，代码会把按 assetId 聚合的高亮合并到 `BookExport`：包含 `ibooks://assetid/<assetId>` 格式的链接。

- **安全与权限**
  - 使用安全范围书签（`BookmarkStore`）保存用户授权的容器路径：
    - `bookmarkData(options: [.withSecurityScope])` 写入 `UserDefaults`。
    - 打开时使用 `startAccessingSecurityScopedResource()` 并在结束时调用 `stopAccessingSecurityScopedResource()` 以满足 macOS 沙盒要求。

- **错误与鲁棒性**
  - 在打开数据库、准备 SQL 或执行查询失败时，抛出 NSError 并在 ViewModel 层捕获以向用户显示错误信息。
  - 在读取列值时，先检查 sqlite3_column_type 为非 NULL，再按类型读取，避免崩溃。
  - 在没有找到数据库文件或目录时，会返回明确错误信息并停止加载流程。

- **开发者注意事项 / 扩展建议**
  - 不同 macOS/iBooks 版本的字段名或表结构可能变化，当前实现通过 `PRAGMA table_info` 动态检测字段是稳妥做法；若需要更稳定兼容性，可加入版本探测或映射层。
  - 日期解析使用 `timeIntervalSinceReferenceDate`，在遇到异常值时应增加容错（例如负数或非常大的数值）。
  - 对大型数据库读取时，目前使用分页 `fetchHighlightPage` 来避免一次性将全部高亮读入内存；根据需求可进一步实现流式读取或背景索引。
  - 若在沙盒外运行（非 Mac App Store），可考虑在打开只读副本后再解析，以避免安全范围书签复杂性。

- **参考代码位置**（便于快速定位）
  - 容器选择与通知：`SyncNos/Services/AppleBooksPicker.swift`
  - 安全书签管理：`SyncNos/Services/BookmarkStore.swift`
  - 数据库连接：`SyncNos/Services/DatabaseConnectionService.swift`
  - 查询实现：`SyncNos/Services/DatabaseQueryService.swift`
  - 服务封装：`SyncNos/Services/DatabaseService.swift`
  - 路径判定与加载流程：`SyncNos/ViewModels/BookViewModel.swift`
  - 数据模型：`SyncNos/Models/Models.swift`
