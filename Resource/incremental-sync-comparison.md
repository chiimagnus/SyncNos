# 增量同步机制对比：WeRead API vs Notion 同步

## 概述

SyncNos 应用涉及两种不同的增量同步机制：

1. **WeRead API → 本地缓存**：从微信读书服务器获取数据
2. **本地数据 → Notion 数据库**：将本地数据同步到 Notion

这两种机制的设计理念和实现方式有显著差异。

---

## 1. WeRead API 增量同步

### 机制：基于 `synckey` 的服务端增量

```
请求流程：
┌─────────────┐     GET /api/user/notebook?synckey=0      ┌─────────────┐
│   Client    │ ─────────────────────────────────────────▶│  WeRead API │
│  (SyncNos)  │                                           │   Server    │
│             │◀───────────────────────────────────────── │             │
└─────────────┘  { synckey: 1234567, books: [...全部...] } └─────────────┘

第二次请求：
┌─────────────┐   GET /api/user/notebook?synckey=1234567  ┌─────────────┐
│   Client    │ ─────────────────────────────────────────▶│  WeRead API │
│  (SyncNos)  │                                           │   Server    │
│             │◀───────────────────────────────────────── │             │
└─────────────┘  { synckey: 1234600, updated: [...],      └─────────────┘
                   removed: ["id1", "id2"] }
```

### 核心代码

```swift
// WeReadIncrementalSyncService.swift
func syncNotebooks() async throws -> WeReadSyncResult {
    // 1. 获取本地 synckey
    let state = try await cacheService.getSyncState()
    let localSyncKey = state.notebookSyncKey ?? 0
    
    // 2. 调用增量 API
    let response = try await apiService.fetchNotebooksIncremental(syncKey: localSyncKey)
    
    // 3. 服务端返回：新 synckey + 变更数据 + 删除列表
    // response.syncKey: 新的 synckey
    // response.updated: 新增/修改的数据
    // response.removed: 被删除的 ID 列表
    
    // 4. 应用变更
    try await cacheService.saveBooks(response.updated)
    if let removed = response.removed {
        try await cacheService.deleteBooks(ids: removed)
    }
    
    // 5. 保存新 synckey
    try await cacheService.updateSyncState(notebookSyncKey: response.syncKey, lastSyncAt: Date())
}
```

### 特点

| 特性 | 说明 |
|------|------|
| **变更检测** | 服务端负责，客户端只需提供 synckey |
| **数据传输** | 只传输变更部分，节省带宽 |
| **删除检测** | 服务端返回 `removed` 数组 |
| **冲突处理** | 无冲突（只有服务端数据） |
| **实现复杂度** | 简单，依赖服务端 |

---

## 2. Notion 同步机制

### 机制：基于 Token 的客户端比对

```
同步流程：
┌─────────────┐                                    ┌─────────────┐
│   本地数据   │                                    │   Notion    │
│ (SQLite/    │                                    │   数据库     │
│  SwiftData) │                                    │             │
└──────┬──────┘                                    └──────┬──────┘
       │                                                  │
       │  1. 读取全部本地高亮                              │
       │◀─────────────────                               │
       │                                                  │
       │  2. 获取 Notion 现有数据及 Token                  │
       │ ──────────────────────────────────────────────▶ │
       │                                                  │
       │  { uuid1: {blockId, token}, uuid2: ... }        │
       │◀────────────────────────────────────────────── │
       │                                                  │
       │  3. 逐条比对 Token                               │
       │     - Token 相同 → 跳过                          │
       │     - Token 不同 → 更新                          │
       │     - 本地有/远端无 → 新增                        │
       │                                                  │
       │  4. 批量更新/新增                                 │
       │ ──────────────────────────────────────────────▶ │
       │                                                  │
```

### 核心代码

```swift
// AppleBooksSyncStrategySingleDB.swift
func syncSmart(book: BookListItem, dbPath: String?, progress: @escaping (String) -> Void) async throws {
    // 1. 获取 Notion 现有数据（UUID → BlockID + Token）
    let existingMapWithToken = try await notionService.collectExistingUUIDMapWithToken(fromPageId: pageId)
    
    // 2. 遍历本地高亮
    var toAppend: [HighlightRow] = []
    var toUpdate: [(String, HighlightRow)] = []
    
    for h in localHighlights {
        if let existing = existingMapWithToken[h.uuid] {
            // 已存在：比对 Token
            let localToken = helper.computeModifiedToken(for: h, source: "appleBooks")
            if existing.token == localToken {
                // Token 相同 → 跳过
            } else {
                // Token 不同 → 需要更新
                toUpdate.append((existing.blockId, h))
            }
        } else {
            // 不存在 → 需要新增
            toAppend.append(h)
        }
    }
    
    // 3. 执行更新和新增
    for (blockId, h) in toUpdate {
        try await notionService.updateBlockContent(blockId: blockId, highlight: h, ...)
    }
    try await notionService.appendHighlightBullets(pageId: pageId, highlights: toAppend)
}
```

### Token 计算逻辑

```swift
// NotionHelperMethods.swift
func computeModifiedToken(for highlight: HighlightRow, source: String) -> String {
    // Apple Books：使用修改时间（如果有）
    if source == "appleBooks", let modified = highlight.modified {
        return isoDateFormatter.string(from: modified)
    }
    
    // 其他来源：使用内容哈希
    let payload = [text, note, style, added, location].joined(separator: "\n")
    let digest = SHA256.hash(data: payload.data(using: .utf8) ?? Data())
    return String(digest.prefix(16))  // 16 字符的哈希前缀
}
```

### 特点

| 特性 | 说明 |
|------|------|
| **变更检测** | 客户端负责，基于 Token 比对 |
| **数据传输** | 需要先获取远端数据，再比对 |
| **删除检测** | ❌ 不支持自动删除 |
| **冲突处理** | 本地优先（覆盖远端） |
| **实现复杂度** | 较复杂，需要维护 Token |

---

## 3. 对比总结

| 维度 | WeRead API 增量同步 | Notion 同步 |
|------|---------------------|-------------|
| **同步方向** | 服务端 → 客户端 | 客户端 → 服务端 |
| **变更检测方** | 服务端 | 客户端 |
| **变更标识** | `synckey`（时间戳） | `token`（哈希/时间） |
| **新增检测** | ✅ `updated` 数组 | ✅ UUID 不存在 |
| **修改检测** | ✅ `updated` 数组 | ✅ Token 不同 |
| **删除检测** | ✅ `removed` 数组 | ❌ 不支持 |
| **带宽效率** | 高（只传变更） | 中（需获取远端列表） |
| **首次同步** | 全量拉取 | 全量推送 |
| **增量同步** | 只传变更 | 需比对全部 |

---

## 4. 优缺点分析

### WeRead API 增量同步

**优点：**
1. ✅ 带宽效率高，只传输变更数据
2. ✅ 实现简单，逻辑在服务端
3. ✅ 支持删除检测
4. ✅ 无需本地维护复杂状态

**缺点：**
1. ❌ 依赖服务端支持
2. ❌ 无法自定义变更检测逻辑
3. ❌ 如果 `synckey` 丢失，需要全量同步

### Notion 同步

**优点：**
1. ✅ 不依赖服务端增量支持
2. ✅ 可自定义变更检测逻辑（Token）
3. ✅ 适用于任何 API（只需 CRUD）
4. ✅ 本地数据为准，适合"推送"场景

**缺点：**
1. ❌ 需要获取远端全部数据进行比对
2. ❌ 不支持删除检测（远端多出的数据不会删除）
3. ❌ 实现复杂度高
4. ❌ 首次同步后，每次仍需获取远端列表

---

## 5. 改进建议

### 对于 Notion 同步

1. **添加删除检测**：
   ```swift
   // 比对远端有但本地没有的 UUID
   let remoteOnlyUUIDs = Set(existingMapWithToken.keys).subtracting(localUUIDs)
   for uuid in remoteOnlyUUIDs {
       // 可选：删除远端数据
       // 或：标记为"已删除"
   }
   ```

2. **优化带宽**：
   - 使用 Notion 的 `filter` 参数减少返回数据
   - 只获取必要字段（UUID、Token）

3. **增量时间戳**：
   - 记录上次同步时间
   - 只比对本地修改时间 > 上次同步时间的数据

### 对于 WeRead 缓存

1. **本地 synckey 备份**：
   - 将 synckey 持久化到 UserDefaults 作为备份
   - SwiftData 损坏时可恢复

2. **全量同步触发条件**：
   - synckey 为 0 或丢失
   - 用户手动触发
   - 缓存数据异常

---

*创建日期: 2025-01-25*

