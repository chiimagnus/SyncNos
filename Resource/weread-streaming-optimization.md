# WeRead 流式加载优化方案（待实现）

## 背景

当用户在一本书中有大量笔记（如 1 万条）时，当前实现需要等待 API 返回全部数据后才能显示，用户体验不佳。

## 当前实现分析

### 数据加载流程

```
当前流程：
1. 从缓存/API 获取全部数据 → allBookmarks (全部在内存)
2. 筛选排序 → filteredHighlights (全部在内存)
3. 分页显示 → visibleHighlights (只显示前 50 条)
```

**问题**：
- 第 1 步需要等待 API 返回全部数据（可能很慢）
- 第 2 步需要处理全部数据
- 虽然第 3 步只显示 50 条，但用户需要等待前两步完成

### 理想流程

```
理想流程：
1. 从缓存加载前 50 条 → 立即显示
2. 后台继续加载更多 → 边加载边更新可用数量
3. 用户滚动时，从已加载的数据中取下一批显示
```

## WeRead API 分页支持调研

### 已知的 API 参数

```
GET /web/book/bookmarklist?bookId=xxx
GET /web/book/bookmarklist?bookId=xxx&synckey=1234567  // 增量同步
```

### 待测试的分页参数

```bash
# 需要认证 Cookie 才能测试
curl -H "Cookie: YOUR_COOKIE" \
     "https://weread.qq.com/web/book/bookmarklist?bookId=BOOK_ID&limit=10"

curl -H "Cookie: YOUR_COOKIE" \
     "https://weread.qq.com/web/book/bookmarklist?bookId=BOOK_ID&count=10&start=0"
```

### 测试方法

1. **浏览器开发者工具**：
   - 打开 https://weread.qq.com 并登录
   - F12 → Network 标签
   - 打开一本有很多高亮的书
   - 查看 `bookmarklist` 请求的响应结构

2. **终端测试**：
   - 从浏览器获取 Cookie
   - 用 curl 测试不同参数

## 替代方案：缓存分页优化

即使 WeRead API 不支持分页，仍可优化用户体验：

### 方案 A：SwiftData 分页查询

```swift
// 修改 WeReadCacheService
func getHighlights(bookId: String, limit: Int, offset: Int) async throws -> [CachedWeReadHighlight] {
    let predicate = #Predicate<CachedWeReadHighlight> { $0.bookId == bookId }
    var descriptor = FetchDescriptor(predicate: predicate)
    descriptor.fetchLimit = limit
    descriptor.fetchOffset = offset
    return try modelContext.fetch(descriptor)
}
```

### 方案 B：流式显示缓存数据

```swift
func loadHighlightsStreaming(for bookId: String) async {
    // 1. 先显示缓存的前 50 条
    let firstBatch = try await cacheService.getHighlights(bookId: bookId, limit: 50, offset: 0)
    visibleHighlights = firstBatch.map { WeReadHighlightDisplay(from: $0) }
    isLoading = false  // 立即结束加载状态
    
    // 2. 后台继续加载剩余数据到内存
    Task {
        var offset = 50
        while true {
            let batch = try await cacheService.getHighlights(bookId: bookId, limit: 50, offset: offset)
            if batch.isEmpty { break }
            allBookmarks.append(contentsOf: batch.map { WeReadBookmark(from: $0) })
            offset += 50
        }
    }
}
```

## 实现优先级

1. ✅ 已完成：DetailView 分页显示（visibleHighlights）
2. ⏳ 待实现：SwiftData 分页查询
3. ⏳ 待实现：流式加载逻辑
4. ⏳ 待调研：WeRead API 分页支持

## 预期效果

| 场景 | 当前 | 优化后 |
|------|------|--------|
| 首次加载 1 万条 | 等待 API 返回全部 | 先显示缓存，后台同步 |
| 再次打开同一本书 | 等待缓存读取全部 | 秒开（分页读取） |
| 滚动加载更多 | 从内存取数据 | 从缓存/内存取数据 |

---

*创建日期: 2025-01-25*
*状态: 待实现*

