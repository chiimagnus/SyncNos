# ChatDetailView 消息删除功能实现方案

## 需求概述
为 `ChatDetailView` 实现单条消息删除功能（不需要多选删除）。

---

## 现有架构分析

### 数据层
- **`ChatMessage`**: 消息模型（内存态）
- **`CachedChatMessageV2`**: SwiftData 持久化模型（加密存储）
- **`ChatCacheServiceProtocol`**: 缓存服务协议（Actor）
- **`ChatCacheService`**: 实现持久化操作

### ViewModel 层
- **`ChatViewModel`**: 管理消息的内存态和持久化
  - `conversations`: 内存中的对话数据
  - `paginationStates`: 分页加载状态
  - 已有 `deleteContact()` 方法删除整个对话

### View 层
- **`ChatDetailView`**: 展示消息列表
- **`ChatMessageBubble`**: 气泡消息组件
- **`ChatSystemMessageRow`**: 系统消息组件
- **`ChatMessageContextMenu`**: 右键菜单组件

### 现有交互模式
消息右键菜单已有：
- 分类切换（对方消息/我的消息/系统消息）
- 设置/清除发送者昵称
- 复制、分享

---

## 实现方案（优先级排序）

### P1: 缓存服务层 - 添加删除消息方法

**文件**: `SyncNos/Services/DataSources-From/Chats/ChatCacheService.swift`

**1.1 更新协议 `ChatCacheServiceProtocol`**

```swift
/// 删除指定消息
func deleteMessage(messageId: String) throws
```

**1.2 实现 `ChatCacheService.deleteMessage()`**

```swift
func deleteMessage(messageId: String) throws {
    let targetId = messageId
    let predicate = #Predicate<CachedChatMessageV2> { msg in
        msg.messageId == targetId
    }
    var descriptor = FetchDescriptor<CachedChatMessageV2>(predicate: predicate)
    descriptor.fetchLimit = 1
    
    guard let message = try modelContext.fetch(descriptor).first else {
        logger.warning("[ChatCacheV2] Message not found for delete: \(messageId)")
        return
    }
    
    // 获取 conversationId 用于更新对话的 updatedAt
    let conversationId = message.conversationId
    
    // 删除消息
    modelContext.delete(message)
    
    // 更新对话的 updatedAt
    let convPredicate = #Predicate<CachedChatConversationV2> { conv in
        conv.conversationId == conversationId
    }
    var convDescriptor = FetchDescriptor<CachedChatConversationV2>(predicate: convPredicate)
    convDescriptor.fetchLimit = 1
    
    if let conversation = try modelContext.fetch(convDescriptor).first {
        conversation.updatedAt = Date()
    }
    
    try modelContext.save()
    logger.info("[ChatCacheV2] Deleted message: \(messageId)")
}
```

**验收标准**: 
- 协议和实现编译通过
- 数据层可以正确删除消息

---

### P2: ViewModel 层 - 添加删除消息方法

**文件**: `SyncNos/ViewModels/Chats/ChatViewModel.swift`

**2.1 添加 `deleteMessage()` 方法**

```swift
/// 删除指定消息
func deleteMessage(messageId: UUID, for contactId: UUID) {
    // 1. 更新 conversations 内存
    if var conversation = conversations[contactId] {
        conversation.messages.removeAll { $0.id == messageId }
        conversations[contactId] = conversation
    }
    
    // 2. 更新 paginationStates 内存
    if var state = paginationStates[contactId] {
        state.loadedMessages.removeAll { $0.id == messageId }
        state.totalCount = max(0, state.totalCount - 1)
        paginationStates[contactId] = state
    }
    
    // 3. 持久化删除
    Task {
        do {
            try await cacheService.deleteMessage(messageId: messageId.uuidString)
            // 从缓存刷新列表（确保 messageCount 和 lastMessage 正确）
            await refreshContactsListFromCache()
            logger.info("[ChatsV2] Deleted message: \(messageId)")
        } catch {
            logger.error("[ChatsV2] Failed to delete message: \(error)")
            errorMessage = "删除消息失败: \(error.localizedDescription)"
        }
    }
}
```

**验收标准**: 
- ViewModel 方法编译通过
- 内存态和持久化正确同步

---

### P3: View 层 - 右键菜单添加删除选项

**文件**: `SyncNos/Views/Chats/Components/ChatMessageContextMenu.swift`

**3.1 添加 `onDelete` 回调参数**

```swift
struct ChatMessageContextMenu: View {
    let text: String
    let isFromMe: Bool
    let kind: ChatMessageKind
    let senderName: String?
    let onSelect: () -> Void
    let onClassify: (_ isFromMe: Bool, _ kind: ChatMessageKind) -> Void
    let onSetSenderName: () -> Void
    let onClearSenderName: () -> Void
    let onDelete: () -> Void  // 新增
    // ...
}
```

**3.2 在右键菜单中添加删除按钮**

在 `Copy` 和 `Share` 之后添加：

```swift
Divider()

Button(role: .destructive) {
    onSelect()
    onDelete()
} label: {
    Label("Delete Message", systemImage: "trash")
}
```

**验收标准**: 
- 右键菜单显示"Delete Message"选项
- 按钮使用 `.destructive` 样式

---

### P4: View 层 - 连接删除回调

**文件**: `SyncNos/Views/Chats/Components/ChatMessageBubble.swift`

**4.1 添加 `onDelete` 参数**

```swift
struct ChatMessageBubble: View {
    let message: ChatMessage
    let isSelected: Bool
    let onTap: () -> Void
    let onClassify: (_ isFromMe: Bool, _ kind: ChatMessageKind) -> Void
    let onSetSenderName: () -> Void
    let onClearSenderName: () -> Void
    let onDelete: () -> Void  // 新增
    // ...
}
```

**4.2 传递给 `ChatMessageContextMenu`**

```swift
.contextMenu {
    ChatMessageContextMenu(
        text: messageContent,
        isFromMe: message.isFromMe,
        kind: message.kind,
        senderName: message.senderName,
        onSelect: onTap,
        onClassify: onClassify,
        onSetSenderName: onSetSenderName,
        onClearSenderName: onClearSenderName,
        onDelete: onDelete  // 新增
    )
}
```

---

**文件**: `SyncNos/Views/Chats/Components/ChatSystemMessageRow.swift`

**4.3 添加 `onDelete` 参数（同上）**

```swift
struct ChatSystemMessageRow: View {
    let message: ChatMessage
    let isSelected: Bool
    let onTap: () -> Void
    let onClassify: (_ isFromMe: Bool, _ kind: ChatMessageKind) -> Void
    let onSetSenderName: () -> Void
    let onClearSenderName: () -> Void
    let onDelete: () -> Void  // 新增
    // ...
}
```

**验收标准**: 
- 气泡和系统消息组件都支持删除回调
- 编译通过

---

### P5: View 层 - ChatDetailView 连接 ViewModel

**文件**: `SyncNos/Views/Chats/ChatDetailView.swift`

**5.1 添加删除处理方法**

```swift
private func handleDeleteMessage(_ message: ChatMessage, for contact: ChatBookListItem) {
    listViewModel.deleteMessage(messageId: message.id, for: contact.contactId)
    // 如果删除的是当前选中的消息，清除选中状态
    if selectedMessageId == message.id {
        selectedMessageId = nil
    }
}
```

**5.2 在消息列表中传递 `onDelete` 回调**

更新 `ChatMessageBubble` 调用：

```swift
ChatMessageBubble(
    message: message,
    isSelected: selectedMessageId == message.id,
    onTap: { selectedMessageId = message.id },
    onClassify: { isFromMe, kind in
        handleClassification(message, isFromMe: isFromMe, kind: kind, for: contact)
    },
    onSetSenderName: {
        handleSetSenderName(message)
    },
    onClearSenderName: {
        handleClearSenderName(message, for: contact)
    },
    onDelete: {
        handleDeleteMessage(message, for: contact)
    }
)
```

更新 `ChatSystemMessageRow` 调用（同上）。

**验收标准**: 
- 右键删除功能完整工作
- 删除后 UI 立即更新
- 删除后列表的 messageCount 正确更新

---

## 测试验收清单

1. [ ] **P1**: `ChatCacheService.deleteMessage()` 方法实现完成，编译通过
2. [ ] **P2**: `ChatViewModel.deleteMessage()` 方法实现完成，编译通过
3. [ ] **P3**: 右键菜单显示"Delete Message"选项
4. [ ] **P4**: `ChatMessageBubble` 和 `ChatSystemMessageRow` 传递 `onDelete` 回调
5. [ ] **P5**: 完整删除流程工作正常
6. [ ] **整体测试**: 
   - 删除消息后立即从 UI 消失
   - 删除后 messageCount 正确更新
   - 重启应用后消息不再出现

---

## 文件修改清单

| 优先级 | 文件路径 | 修改类型 |
|--------|----------|----------|
| P1 | `Services/DataSources-From/Chats/ChatCacheService.swift` | 添加方法 |
| P2 | `ViewModels/Chats/ChatViewModel.swift` | 添加方法 |
| P3 | `Views/Chats/Components/ChatMessageContextMenu.swift` | 添加参数和按钮 |
| P4 | `Views/Chats/Components/ChatMessageBubble.swift` | 添加参数 |
| P4 | `Views/Chats/Components/ChatSystemMessageRow.swift` | 添加参数 |
| P5 | `Views/Chats/ChatDetailView.swift` | 添加方法和传递回调 |

---

## 设计决策说明

1. **不添加确认对话框**: macOS 应用通常通过 Cmd+Z 支持撤销，而不是通过确认对话框打断用户操作。由于当前应用未实现撤销功能，且聊天记录可重新导入，因此暂不添加确认对话框。如果后续需要，可以使用 `.alert` 实现。

2. **删除后刷新列表**: 调用 `refreshContactsListFromCache()` 确保左侧列表的 `messageCount` 和 `lastMessage` 正确更新。

3. **删除时清除选中状态**: 避免 UI 状态不一致。

4. **遵循现有模式**: 与 `updateMessageClassification()` 和 `updateMessageSenderName()` 保持一致的实现模式。

