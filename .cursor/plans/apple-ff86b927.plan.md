<!-- ff86b927-dbc7-4b41-b87e-f6bc2bbd9523 645acdfe-d4a3-4339-9d77-fd56d254646b -->
# AppleBooks 过滤与排序实现计划

### 范围与交互

- 在 `MainListView` 工具栏加入过滤图标菜单（仅当 `contentSource == .appleBooks` 时显示），提供：
  - 排序：标题首字母、笔记数量、上次同步时间、上次编辑时间、创建时间（均支持升/降序）
  - 过滤：是否只显示“有书名”的条目（默认开启）
- 在 `AppleBookDetailView` 工具栏加入过滤图标菜单，提供：
  - 排序：按上次编辑时间/创建时间/位置（升/降序）
  - 过滤：按是否含 note（全部/仅含/仅不含）、按颜色（多选）
- 使用 `@AppStorage` 持久化用户选择。

### 数据模型更新（`SyncNos/Models/Models.swift`）

- 新增：
  - `struct AssetHighlightStats { let assetId: String; let count: Int; let minCreationDate: Date?; let maxModifiedDate: Date? }`
  - `enum BookListSortKey { case title, highlightCount, lastSync, lastEdited, created }`
  - `struct BookListSort { var key: BookListSortKey; var ascending: Bool }`
  - `enum NoteFilter { case any, hasNote, noNote }`
  - `enum HighlightOrder { case createdAsc, createdDesc, modifiedAsc, modifiedDesc, locationAsc, locationDesc }`
- 扩展：`BookListItem` 新增可选元数据字段用于排序（不影响现有使用）：
  - `createdAt: Date?`, `modifiedAt: Date?`, `hasTitle: Bool`

### 服务层与SQL（Server-side）

- `DatabaseQueryService`
  - 新增 `fetchHighlightStatsByAsset(db:) -> [AssetHighlightStats]`
    - 动态检测列：若存在 `ZANNOTATIONCREATIONDATE`/`ZANNOTATIONMODIFICATIONDATE` 则聚合，否则返回 `NULL`
    - 代表性 SQL（按列存在性动态生成）：
```sql
SELECT ZANNOTATIONASSETID,
       COUNT(*) AS c,
       MIN(ZANNOTATIONCREATIONDATE) AS minC,
       MAX(ZANNOTATIONMODIFICATIONDATE) AS maxM
FROM ZAEANNOTATION
WHERE ZANNOTATIONDELETED=0 AND ZANNOTATIONSELECTEDTEXT NOT NULL
GROUP BY ZANNOTATIONASSETID;
```

  - 扩展 `fetchHighlightPage(...)` 支持排序与过滤参数：`order: HighlightOrder`, `noteFilter: NoteFilter?`, `styles: [Int]?`
    - 过滤片段（按需拼接）：
```sql
-- note 过滤
(ZANNOTATIONNOTE IS NOT NULL AND TRIM(ZANNOTATIONNOTE) <> '')    -- hasNote
(ZANNOTATIONNOTE IS NULL OR TRIM(ZANNOTATIONNOTE) = '')          -- noNote

-- 颜色过滤
ZANNOTATIONSTYLE IN (?,?,...)
```

    - 排序片段（按列存在性选择，缺失时回退 rowid）：
```sql
ORDER BY ZANNOTATIONCREATIONDATE DESC
ORDER BY ZANNOTATIONMODIFICATIONDATE DESC
ORDER BY CAST(ZANNOTATIONLOCATION AS INTEGER) ASC
```

- `DatabaseService` / `DatabaseReadOnlySession`
  - 添加 `fetchHighlightStatsByAsset` 透传 API
  - 为 `fetchHighlightPage` 添加带排序/过滤参数的重载

### BookViewModel（`SyncNos/ViewModels/BookViewModel.swift`）

- 新增 `@Published var sort = BookListSort(key: .title, ascending: true)`
- 新增 `@Published var showWithTitleOnly = true`（`@AppStorage` 同步键：`bookList_showWithTitleOnly`）
- 将原 `books` 视为“原始数据”；新增只读 `var displayBooks: [BookListItem]`（根据 `sort` 与 `showWithTitleOnly` 派生）
- 加载逻辑：
  - 从注释库获取 `AssetHighlightStats`（计数、min 创建、max 修改）
  - 从 BKLibrary 获取存在的 `BookRow`（标题/作者）
  - 对于 BKLibrary 缺失的 assetId 也创建 `BookListItem`：`bookTitle = ""`, `authorName = ""`, `hasTitle = false`
  - 设置 `createdAt`/`modifiedAt`/`highlightCount`
  - `displayBooks` 排序：
    - `.title`: 本地字符串比较
    - `.highlightCount`: 计数
    - `.lastEdited`/`.created`: 使用 `modifiedAt`/`createdAt`
    - `.lastSync`: 使用 `SyncTimestampStore.getLastSyncTime(for:)`
  - 过滤：`showWithTitleOnly` 时只保留 `hasTitle == true`

### AppleBooksListView（`SyncNos/Views/AppleBooks/AppleBooksListView.swift`）

- 使用 `viewModel.displayBooks` 驱动 `List`
- `onChange` 针对 `displayBooks` 更新默认选中项

### MainListView 工具栏（`SyncNos/MainListView.swift`）

- 新增一个 `ToolbarItem`（过滤图标 `line.3.horizontal.decrease.circle`）：
  - 子菜单 1：排序（单选）+ 升/降序切换
  - 子菜单 2：过滤（勾选）“仅显示有书名”
- 仅在 `contentSource == .appleBooks` 时显示

### AppleBookDetailViewModel（`SyncNos/ViewModels/AppleBookDetailViewModel.swift`）

- 新增：
  - `@Published var order: HighlightOrder = .createdDesc`
  - `@Published var noteFilter: NoteFilter = .any`
  - `@Published var selectedStyles: Set<Int> = []`（空表示不过滤）
- 在 `resetAndLoadFirstPage`/`loadNextPage` 调用会话分页 API 时传入上述参数
- 当 `order`/`noteFilter`/`selectedStyles` 变化时：清空并重新加载第一页

### AppleBookDetailView 工具栏（`SyncNos/Views/AppleBooks/AppleBookDetailView.swift`）

- 新增过滤图标 `ToolbarItem` 的 `Menu`：
  - 排序：创建/修改/位置（升/降）
  - 过滤：note（三态：全部/仅含/仅不含）
  - 颜色：为 0..5 提供多选项（含“全选/清空”）

### 本地化与持久化

- 使用 `@AppStorage` 持久化以下偏好：
  - 书单：`bookList_sort_key`、`bookList_sort_ascending`、`bookList_showWithTitleOnly`
  - 详情：`detail_sort_key`、`detail_sort_ascending`、`detail_note_filter`、`detail_selected_styles`
- 文案采用现有英文/中文混排风格，后续可补 `Localizable.xcstrings`

### 边界与回退

- 若数据库缺失相关列：排序回退到 `rowid`，过滤条件跳过对应列
- 颜色过滤为空集则视为“不过滤”
- 缺失书名条目默认隐藏，用户可在菜单中切换显示

### 简要代码片段（仅示例）

```swift
// 详情分页 SQL 片段（示例）
var whereConds = ["ZANNOTATIONDELETED=0","ZANNOTATIONSELECTEDTEXT NOT NULL","ZANNOTATIONASSETID=?"]
if noteFilter == .hasNote { whereConds.append("ZANNOTATIONNOTE IS NOT NULL AND TRIM(ZANNOTATIONNOTE) <> ''") }
if noteFilter == .noNote  { whereConds.append("ZANNOTATIONNOTE IS NULL OR TRIM(ZANNOTATIONNOTE) = ''") }
if !styles.isEmpty { whereConds.append("ZANNOTATIONSTYLE IN (" + styles.map{ _ in "?" }.joined(separator: ",") + ")") }
let orderBy = "ZANNOTATIONCREATIONDATE DESC" // 按选择动态生成
```

### To-dos

- [ ] Add models/enums for sort/filter and AssetHighlightStats
- [ ] Add fetchHighlightStatsByAsset to query/service/session
- [ ] Extend fetchHighlightPage with order and filters
- [ ] Add sort/filter state and displayBooks to BookViewModel
- [ ] Load stats+metadata, include missing titles, compute created/modified
- [ ] Bind AppleBooksListView to displayBooks and default selection
- [ ] Add filter/sort menu toolbar in MainListView for AppleBooks
- [ ] Add order/noteFilter/styles to AppleBookDetailViewModel
- [ ] Wire detail pagination to new filters/sort and reload on change
- [ ] Add filter/sort menu toolbar in AppleBookDetailView
- [ ] Persist preferences with AppStorage keys for list and detail
- [ ] Manual QA: large DBs, missing columns, selection, defaults