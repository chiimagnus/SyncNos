# WechatChat 分页加载实现计划

## 一、需求背景

当用户的对话消息数量达到 2000 条以上时，一次性加载所有消息会导致：
1. **内存占用过高**：所有消息同时在内存中
2. **首屏加载慢**：需要等待所有消息加载完成
3. **滚动卡顿**：大量 View 节点影响渲染性能

## 二、设计目标

1. **首屏快速加载**：首次只加载最新的 N 条消息
2. **无缝加载更多**：用户滚动到顶部时自动加载更早的消息
3. **保持滚动位置**：加载更多后不跳动，用户继续查看当前位置
4. **内存优化**：可选的虚拟化（后续迭代）

## 三、技术方案

### 3.1 分页方向

微信聊天的阅读习惯：
- **默认显示最新消息**（列表底部）
- **向上滚动加载更早的消息**

因此采用 **倒序分页**：
- 第一页：最新的 N 条消息（order 最大）
- 第二页：次新的 N 条消息
- 以此类推

### 3.2 分页参数

```swift
struct WechatChatPaginationConfig {
    static let pageSize = 50                    // 每页消息数
    static let preloadThreshold = 10            // 距离顶部多少条时预加载
    static let initialLoadSize = 50             // 首次加载数量
}
```

### 3.3 数据流

```
┌─────────────────────────────────────────────────────────────┐
│                    WechatChatDetailView                      │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                    ScrollView                         │    │
│  │  ┌─────────────────────────────────────────────┐     │    │
│  │  │  LoadMoreIndicator (顶部)                    │     │    │
│  │  │  - 当 canLoadMore && isNearTop 时显示        │     │    │
│  │  └─────────────────────────────────────────────┘     │    │
│  │                                                       │    │
│  │  ┌─────────────────────────────────────────────┐     │    │
│  │  │  LazyVStack                                  │     │    │
│  │  │  - ForEach(messages) { MessageBubble }       │     │    │
│  │  │  - LoadMoreIndicator.onAppear 作为触发哨兵    │     │    │
│  │  │  - prepend 后 scrollTo 锚回旧第一条，保持位置 │     │    │
│  │  └─────────────────────────────────────────────┘     │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   WechatChatViewModel                        │
│                                                              │
│  - loadedMessages: [WechatMessage]       // 已加载的消息     │
│  - currentOffset: Int                    // 当前偏移量       │
│  - totalCount: Int                       // 总消息数         │
│  - canLoadMore: Bool                     // 是否还有更多     │
│  - isLoadingMore: Bool                   // 正在加载中       │
│                                                              │
│  func loadInitialMessages(contactId:)    // 首次加载         │
│  func loadMoreMessages(contactId:)       // 加载更多         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 WechatChatCacheService                       │
│                                                              │
│  func fetchMessagesPage(                                     │
│      conversationId: String,                                 │
│      limit: Int,                                             │
│      offset: Int,                                            │
│      ascending: Bool = true                                  │
│  ) async throws -> [WechatMessage]                           │
│                                                              │
│  func fetchMessageCount(conversationId:) -> Int              │
└─────────────────────────────────────────────────────────────┘
```

## 四、实现步骤

### 步骤 1：扩展 WechatChatCacheService

**文件**：`Services/DataSources-From/WechatChat/WechatChatCacheService.swift`

新增方法：

```swift
/// 分页查询消息
/// - Parameters:
///   - conversationId: 对话 ID
///   - limit: 每页数量
///   - offset: 偏移量（从最新消息开始计算）
/// - Returns: 消息列表（按 order 升序，即时间正序）
func fetchMessagesPage(
    conversationId: String,
    limit: Int,
    offset: Int
) async throws -> [WechatMessage]

/// 获取对话消息总数
func fetchMessageCount(conversationId: String) async throws -> Int
```

**SQL 逻辑**：
```sql
-- 获取第 N 页（从最新开始）
SELECT * FROM CachedWechatMessageV2
WHERE conversationId = ?
ORDER BY messageOrder DESC
LIMIT ? OFFSET ?

-- 返回结果后在代码中反转为正序
```

### 步骤 2：扩展 WechatChatViewModel

**文件**：`ViewModels/WechatChat/WechatChatViewModel.swift`

新增属性：

```swift
/// 分页状态（每个对话独立管理）
struct ConversationPaginationState {
    var loadedMessages: [WechatMessage] = []
    var currentOffset: Int = 0
    var totalCount: Int = 0
    var isLoadingMore: Bool = false
    
    var canLoadMore: Bool {
        currentOffset + loadedMessages.count < totalCount
    }
    
    var hasLoadedAll: Bool {
        !canLoadMore
    }
}

/// 每个对话的分页状态
@Published private(set) var paginationStates: [UUID: ConversationPaginationState] = [:]
```

新增方法：

```swift
/// 加载对话的初始消息（最新的一页）
func loadInitialMessages(for contactId: UUID) async

/// 加载更早的消息
func loadMoreMessages(for contactId: UUID) async

/// 获取当前已加载的消息（供 View 使用）
func getLoadedMessages(for contactId: UUID) -> [WechatMessage]

/// 是否可以加载更多
func canLoadMore(for contactId: UUID) -> Bool

/// 是否正在加载
func isLoadingMore(for contactId: UUID) -> Bool
```

### 步骤 3：修改 WechatChatDetailView

**文件**：`Views/WechatChat/WechatChatDetailView.swift`

修改点：

1. **消息数据源**：从 `viewModel.getMessages(for:)` 改为 `viewModel.getLoadedMessages(for:)`

2. **首次加载**：
```swift
.task(id: selectedContactId) {
    if let contactId = selectedContact?.contactId {
        await listViewModel.loadInitialMessages(for: contactId)
    }
}
```

3. **滚动到顶部时加载更多**：
```swift
// ✅ 使用顶部 LoadMoreIndicator 作为“单一触发点”（避免按消息 onAppear 造成 prepend 连锁加载）
if canLoadMore {
    HStack { ... }
        .id("loadMoreIndicator")
        .onAppear {
            loadMoreAndPreservePosition(for: contact, proxy: proxy)
        }
}
```

4. **顶部加载指示器**：
```swift
if listViewModel.isLoadingMore(for: contactId) {
    HStack {
        ProgressView()
        Text("加载更多...")
            .font(.caption)
            .foregroundColor(.secondary)
    }
    .frame(maxWidth: .infinity)
    .padding()
}
```

5. **保持滚动位置**：
加载更多是 prepend（更早消息插入数组头部）。如果不做位置保持，用户停在顶部时会立刻看到新插入的消息并持续触发加载，最终一次性把所有历史拉完。

实现方式：在触发加载前记录 prepend 前的第一条消息 ID，加载完成后 `scrollTo` 回该消息（`anchor: .top`），让视口保持在原位置，用户需要继续向上滚动才会再次触发。

```swift
private func loadMoreAndPreservePosition(for contact: WechatBookListItem, proxy: ScrollViewProxy) {
    guard viewModel.canLoadMore(for: contact.contactId),
          !viewModel.isLoadingMore(for: contact.contactId) else { return }

    let anchorId = viewModel.getLoadedMessages(for: contact.contactId).first.map { compositeId(for: $0) }

    Task { @MainActor in
        await viewModel.loadMoreMessages(for: contact.contactId)
        guard let anchorId else { return }
        DispatchQueue.main.async {
            withAnimation(nil) { proxy.scrollTo(anchorId, anchor: .top) }
        }
    }
}
```

### 步骤 4：更新 loadFromCache 逻辑

当前 `loadFromCache()` 加载所有消息。修改为：
- 只加载对话列表（联系人信息）
- 消息延迟到选中对话时分页加载

```swift
func loadFromCache() async {
    isLoading = true
    defer { isLoading = false }

    do {
        // 只加载对话列表，不加载消息
        let cachedContacts = try await cacheService.fetchAllConversations()
        contacts = cachedContacts
        
        // 初始化空的 conversations 字典
        for item in cachedContacts {
            let contact = WechatContact(...)
            conversations[item.contactId] = WechatConversation(contact: contact, messages: [])
            
            // 初始化分页状态
            let totalCount = try await cacheService.fetchMessageCount(conversationId: item.id)
            paginationStates[item.contactId] = ConversationPaginationState(totalCount: totalCount)
        }
    } catch {
        // ...
    }
}
```

## 五、用户体验优化

### 5.1 加载动画

- 首次加载：居中 ProgressView
- 加载更多：顶部小型 ProgressView + "加载更多..."

### 5.2 滚动行为

- 首次进入对话：自动滚动到底部（最新消息）
- 加载更多后：保持当前滚动位置不变

### 5.3 空状态

- 对话无消息：显示 "暂无消息" + 导入截图按钮
- 加载失败：显示错误信息 + 重试按钮

## 六、边界情况

1. **快速切换对话**：取消正在进行的加载任务
2. **重复加载**：`isLoadingMore` 防止重复触发
3. **消息更新**：新导入截图后，重置分页状态
4. **消息分类变更**：更新 `loadedMessages` 中对应消息

## 七、测试要点

1. **首次加载**：验证只加载最新的 N 条消息
2. **滚动加载**：验证滚动到顶部时自动加载更多
3. **位置保持**：验证加载更多后不跳动
4. **大数据量**：模拟 2000+ 条消息，验证性能
5. **快速切换**：快速切换对话，验证无竞态问题

## 八、配置参数

```swift
// 可在 NotionSyncConfig 或单独的配置文件中定义
enum WechatChatPaginationConfig {
    static let pageSize = 50                    // 每页消息数
    static let preloadThreshold = 10            // 预留：如需“提前 N 条预加载”可启用（当前实现用顶部哨兵触发）
    static let initialLoadSize = 50             // 首次加载数量
}
```

## 九、代码变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `WechatChatCacheService.swift` | 修改 | 添加分页查询方法 |
| `WechatChatCacheService.swift` 协议 | 修改 | 添加协议方法声明 |
| `WechatChatViewModel.swift` | 修改 | 添加分页状态管理 |
| `WechatChatDetailView.swift` | 修改 | 集成分页 UI |
| `WechatChatListView.swift` | 微调 | 可能需要调整加载逻辑 |

## 十、时间估算

| 步骤 | 估算时间 |
|------|----------|
| 步骤 1：CacheService 分页 | 15 分钟 |
| 步骤 2：ViewModel 分页状态 | 20 分钟 |
| 步骤 3：DetailView 集成 | 25 分钟 |
| 步骤 4：loadFromCache 优化 | 10 分钟 |
| 测试和调试 | 20 分钟 |
| **总计** | **~90 分钟** |

---

*创建时间：2025-12-26*

