# Apple Books 和 GoodLinks 同步到 Notion 的详细报告

现在请你制定一份详细的报告，关于applebooks highlight笔记同步的、关于goodlinks article文章和highlight笔记同步的报告。侧重点是，同步到notion的技术报告。

比如Apple Books中的笔记同步到notion的方案是什么，当我在本地修改数据的之后，是否会更新到notion中？
比如删掉了一条highlight是否会同步更新到notion，在notion中也删掉这条highlight；
比如在已有的highlight中修改数据，是否也会在notion中更新？
等等等等。

注意：请你一一查看所有相关的代码，然后再开始生成一份详细的报告。

## Apple Books 高亮同步

- **数据源解析**：`DatabaseQueryService.fetchHighlightPage` 会动态检测 Apple Books SQLite 表字段，拉取文本、笔记、颜色、创建与修改时间，并排除 `ZANNOTATIONDELETED=0` 的记录，支持增量条件 `ZANNOTATIONMODIFICATIONDATE >= ?`。
```242:292:/Users/chii_magnus/Github_OpenSource/SyncNos/SyncNos/Services/1-AppleBooks/DatabaseQueryService.swift
if since != nil && availableColumns.contains("ZANNOTATIONMODIFICATIONDATE") {
    whereConditions.append("ZANNOTATIONMODIFICATIONDATE >= ?")
}
```

- **Notion 载体结构（单库方案，默认）**：每次同步会确保全局数据库 `SyncNos-AppleBooks` 存在，并按书籍 Asset ID 创建/复用单个页面。页面属性包含标题、作者、`Last Sync Time` 等。
```25:44:/Users/chii_magnus/Github_OpenSource/SyncNos/SyncNos/Services/0-NotionAPI/1-AppleBooksSyncToNotion/AppleBooksSyncStrategySingleDB.swift
let databaseId = try await notionService.ensureDatabaseIdForSource(title: "SyncNos-AppleBooks", parentPageId: parentPageId, sourceKey: "appleBooks")
let ensuredPage = try await notionService.ensureBookPageInDatabase(
    databaseId: databaseId,
    bookTitle: book.bookTitle,
    author: book.authorName,
    assetId: book.bookId,
    urlString: book.ibooksURL,
    header: "Highlights"
)
```

- **高亮落库格式**：每条高亮写成一个 `numbered_list_item` block，首段注入 `[uuid:xxx]`，后续子块包含长文本续段、斜体笔记与元数据。这个 UUID 是后续增量更新的锚点。
```91:168:/Users/chii_magnus/Github_OpenSource/SyncNos/SyncNos/Services/0-NotionAPI/Core/NotionHelperMethods.swift
let uuidPrefix = "[uuid:\(highlight.uuid)]\n"
...
return [
    "object": "block",
    "numbered_list_item": numbered
]
```

- **首次（全量）同步**：遍历整本书的高亮，过滤掉 Notion 已存在的 UUID（防止重复），剩余部分批量追加。同步后刷新页面的高亮计数与 `Last Sync Time`。
```112:131:/Users/chii_magnus/Github_OpenSource/SyncNos/SyncNos/Services/0-NotionAPI/1-AppleBooksSyncToNotion/AppleBooksSyncStrategySingleDB.swift
let fresh = page.filter { !existingUUIDs.contains($0.uuid) }
...
try await notionService.appendHighlightBullets(pageId: pageId, bookId: book.bookId, highlights: newRows)
```

- **增量同步（单库方案）**：根据 `SyncTimestampStore` 记录的上次时间窗口读取高亮；对已存在的 UUID 调用 `updateBlockContent(source: "appleBooks")` 覆盖文本/笔记，缺失的 UUID 视为新增 block，再次更新计数和时间戳。
```88:106:/Users/chii_magnus/Github_OpenSource/SyncNos/SyncNos/Services/0-NotionAPI/1-AppleBooksSyncToNotion/AppleBooksSyncStrategySingleDB.swift
for (blockId, h) in toUpdate { try await notionService.updateBlockContent(blockId: blockId, highlight: h, bookId: book.bookId, source: "appleBooks") }
if !toAppend.isEmpty {
    try await notionService.appendHighlightBullets(pageId: pageId, bookId: book.bookId, highlights: toAppend)
}
```
  - **本地修改是否能刷新到 Notion？** 能——前提是 Apple Books 数据库的 `ZANNOTATIONMODIFICATIONDATE` 更新。若该字段未变化（例如第三方工具修改但未写回修改时间），增量同步会跳过更新，可改走“强制全量”或清空时间戳作为变通。
  - **删除是否同步？** 否。代码里只“更新或追加”，没有扫描 Notion 上多余的 UUID 做删除；本地删掉后 Notion 仍保留，需要手动清理或未来扩展对比集合实现清除。

- **每书独立数据库方案**：为每本书创建独立的 Notion 数据库，高亮对应数据库条目。同步逻辑类似：命中 UUID 的条目调用 `updateHighlightItem` 更新属性与子内容，缺失则 `createHighlightItem` 新建；同样没有删除流程。
```46:74:/Users/chii_magnus/Github_OpenSource/SyncNos/SyncNos/Services/0-NotionAPI/1-AppleBooksSyncToNotion/AppleBooksSyncStrategyPerBook.swift
if let existingPageId = try await notionService.findHighlightItemPageIdByUUID(databaseId: databaseId, uuid: h.uuid) {
    try await notionService.updateHighlightItem(pageId: existingPageId, bookId: book.bookId, bookTitle: book.bookTitle, author: book.authorName, highlight: h)
} else {
    _ = try await notionService.createHighlightItem(inDatabaseId: databaseId, bookId: book.bookId, bookTitle: book.bookTitle, author: book.authorName, highlight: h)
}
```

- **时间戳管理**：Apple Books 使用 `SyncTimestampStore`（UserDefaults）按 `bookId` 记忆最后一次成功同步时间，增量模式依赖这份记录。
```12:27:/Users/chii_magnus/Github_OpenSource/SyncNos/SyncNos/Services/0-NotionAPI/1-AppleBooksSyncToNotion/SyncTimestampStore.swift
func getLastSyncTime(for bookId: String) -> Date? { ... }
func setLastSyncTime(for bookId: String, to date: Date) { ... }
```

## GoodLinks 文章 & 高亮同步

- **数据源解析**：`GoodLinksQueryService` 从 GoodLinks SQLite `link`/`highlight`/`content` 表分页读取文章、正文与高亮，按 `time` 倒序且无删除过滤，因此会返回所有仍存在于库中的记录。
```63:85:/Users/chii_magnus/Github_OpenSource/SyncNos/SyncNos/Services/2-GoodLinks/GoodLinksQueryService.swift
let sql = "SELECT id, linkID, content, color, note, time FROM highlight WHERE linkID=? ORDER BY time DESC LIMIT ? OFFSET ?;"
...
rows.append(GoodLinksHighlightRow(id: id, linkId: linkId, content: content, color: color, note: note, time: time))
```

- **Notion 载体结构**：单一数据库 `SyncNos-GoodLinks`；每篇文章对应一个页面，页面属性保存标签、摘要、收藏状态、添加/修改时间等。
```74:97:/Users/chii_magnus/Github_OpenSource/SyncNos/SyncNos/Services/0-NotionAPI/2-GoodLinksSyncToNotion/GoodLinksSyncService.swift
if let summary = link.summary, !summary.isEmpty {
    properties["Summary"] = ["rich_text": [["text": ["content": summary]]]]
}
properties["Starred"] = ["checkbox": link.starred]
...
try await notionService.updatePageProperties(pageId: pageId, properties: properties)
```

- **页面内容布局**：初次同步时写入文章正文（`Article` 标题下的段落）和 `Highlights` 标题，再逐条插入高亮 block（结构与 Apple Books 相同，但 `source` 为 `"goodLinks"`，颜色映射会转换成 Notion 名称）。
```99:143:/Users/chii_magnus/Github_OpenSource/SyncNos/SyncNos/Services/0-NotionAPI/2-GoodLinksSyncToNotion/GoodLinksSyncService.swift
var headerChildren: [[String: Any]] = []
headerChildren.append([
    "object": "block",
    "heading_2": [
        "rich_text": [["text": ["content": "Article"]]]
    ]
])
...
let block = helper.buildBulletedListItemBlock(for: fakeHighlight, bookId: link.id, maxTextLength: NotionSyncConfig.maxTextLengthPrimary, source: "goodLinks")
```

- **增量行为（现已破坏式改造）**：
  - 重新扫描 Notion 页面收集 `[uuid:...] → blockId` 映射。
  - 构造本地高亮的伪 `HighlightRow`，区分“已存在”与“新增”。
  - **已存在**：逐条调用 `updateBlockContent(source: "goodLinks")`，因此不依赖 GoodLinks 端的修改时间字段；无论内容是否变化都会写回 Notion，确保本地编辑（文本或笔记）可覆盖。
  - **新增**：批量追加新的 block。
```157:196:/Users/chii_magnus/Github_OpenSource/SyncNos/SyncNos/Services/0-NotionAPI/2-GoodLinksSyncToNotion/GoodLinksSyncService.swift
if let blockId = existingMap[h.id] {
    toUpdate.append((blockId, fakeHighlight))
} else {
    toAppendHighlights.append(fakeHighlight)
}
...
for (blockId, h) in toUpdate {
    try await notionService.updateBlockContent(blockId: blockId, highlight: h, bookId: link.id, source: "goodLinks")
}
```

- **删除同步**：目前不支持。`existingMap` 仅用于识别“是否需要更新”，没有任何逻辑去识别“Notion 中存在但本地缺失”的 UUID，自然不会删除 Notion 的高亮。删除文章、高亮时需要手动在 Notion 端处理或额外实现差集清理。

- **时间戳记录**：同样借助 `SyncTimestampStore`，以 GoodLinks `link.id` 为键更新最后同步时间。但增量流程并不使用时间戳做过滤（全部遍历了 `collected`），因此即便时间戳缺失也能保证数据一致。

## 共通机制与评估

- **UUID 映射管线**：`collectExistingUUIDToBlockIdMapping` 会遍历 Notion block，解析 `[uuid:...]` 文本并建立映射表，这是所有更新操作的基础。
```67:94:/Users/chii_magnus/Github_OpenSource/SyncNos/SyncNos/Services/0-NotionAPI/Operations/NotionQueryOperations.swift
if let startRange = s.range(of: "[uuid:") {
    let startIdx = startRange.upperBound
    if let endRange = s.range(of: "]", range: startIdx..<s.endIndex) {
        let idPart = String(s[startIdx..<endRange.lowerBound])
        collected[idPart] = block.id
    }
}
```

- **高亮内容更新**：统一走 `NotionHighlightOperations.updateBlockContent(blockId:bookId:source:)`，把主 block 与子块一次性替换，确保文本、笔记、元数据（颜色、时间）全量覆盖。
```43:56:/Users/chii_magnus/Github_OpenSource/SyncNos/SyncNos/Services/0-NotionAPI/Operations/NotionHighlightOperations.swift
let parentRt = helperMethods.buildParentRichText(for: highlight, bookId: bookId, maxTextLength: NotionSyncConfig.maxTextLengthPrimary)
...
childBlocks.append(helperMethods.buildMetaAndLinkBulletChild(for: highlight, bookId: bookId, source: source))
try await pageOperations.replacePageChildren(pageId: blockId, with: childBlocks)
```

- **计数与时间**：Apple Books、GoodLinks 在每轮同步结尾都会调用 `updatePageHighlightCount` 和 `Last Sync Time` 属性，持续向 UI 和筛选模块提供同步状态。

- **目前缺失/限制**：
  - 双方都未实现“删除 Notion 高亮以匹配本地删除”。
  - Apple Books 单库增量依赖修改时间字段；若 Apple Books 不更新该字段（偶发）则需要强制全量或手动清空时间戳。
  - GoodLinks 没有跳过未变更项（默认全量覆盖），在大数据量时请求量会偏大，但能确保一致性。

### 建议方向
- 若要支持删除同步，可在现有 `existingMap` 基础上，计算 `existingUUIDs - collectedUUIDs` 并调用 Notion block 删除或归档 API。
- 对 Apple Books 可新增“强制全量”开关或对比文本差异后再决定是否调用 update，兼顾性能与可靠性。
- GoodLinks 可以引入本地 `modifiedAt`（若数据库提供）或内容 hash，减少不必要的 PATCH。

综上，当前同步方案支持“新增”“修改”全量覆盖（GoodLinks 始终覆盖，Apple Books 依据修改时间覆盖）；“删除”尚未实现自动下行，需要手动处理或未来增强。