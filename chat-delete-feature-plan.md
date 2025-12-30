# Chat Detail View 删除功能实现方案 (Plan A)

## 项目背景

当前 ChatDetailView 支持消息的查看、分类、导入、导出等功能，但缺少删除单条消息的能力。本方案将为 ChatDetailView 实现单条消息删除功能（不支持多选删除）。

## 技术栈分析

- **架构**: MVVM (SwiftUI + ObservableObject)
- **数据持久化**: SwiftData (ChatCacheService - @ModelActor)
- **UI层**: ChatDetailView + ChatMessageBubble/ChatSystemMessageRow
- **业务逻辑**: ChatViewModel
- **数据模型**: ChatMessage (内存) / CachedChatMessageV2 (持久化)

## 现有相关功能分析

### 1. 已有的删除功能参考
- `ChatViewModel.deleteContact()` - 删除整个对话
- `ChatCacheService.deleteConversation()` - 删除对话的持久化数据
- 其他数据源也有类似模式 (WeRead, Dedao)

### 2. 现有的消息操作
- **分类**: `updateMessageClassification()` - 更改消息方向（我/对方/系统）
- **昵称**: `updateMessageSenderName()` - 设置发送者昵称
- **复制/分享**: 通过 `ChatMessageContextMenu` 实现

### 3. 数据同步层次
```
UI Layer (ChatDetailView)
    ↓
ViewModel (ChatViewModel)
    ↓ 同步更新 3 处
    ├─ conversations[contactId]?.messages  (内存，用于导出)
    ├─ paginationStates[contactId]?.loadedMessages (内存，用于UI显示)
    └─ ChatCacheService (持久化，SwiftData)
```

## 实现方案 (按优先级)

### P1: 数据层 - 添加删除消息的服务方法

**目标**: 在 ChatCacheService 中实现删除单条消息的功能

**文件修改**:
- `Services/DataSources-From/Chats/ChatCacheService.swift`

**实现内容**:

1. 在 `ChatCacheServiceProtocol` 中添加方法声明:
```swift
func deleteMessage(messageId: String) throws
```

2. 在 `ChatCacheService` 中实现方法:
```swift
func deleteMessage(messageId: String) throws {
    let targetId = messageId
    let predicate = #Predicate<CachedChatMessageV2> { msg in
        msg.messageId == targetId
    }
    var descriptor = FetchDescriptor<CachedChatMessageV2>(predicate: predicate)
    descriptor.fetchLimit = 1
    
    if let message = try modelContext.fetch(descriptor).first {
        modelContext.delete(message)
        try modelContext.save()
        logger.info("[ChatCacheV2] Deleted message: \(messageId)")
    }
}
```

**验证方式**:
- 编译检查（确保协议和实现匹配）
- 代码审查（确保遵循现有代码风格）

---

### P2: 业务逻辑层 - 在 ViewModel 中添加删除消息方法

**目标**: 在 ChatViewModel 中实现删除消息的业务逻辑，保持三层数据同步

**文件修改**:
- `ViewModels/Chats/ChatViewModel.swift`

**实现内容**:

添加公共方法 `deleteMessage`:
```swift
/// 删除单条消息
/// - Parameters:
///   - messageId: 消息ID
///   - contactId: 对话ID
func deleteMessage(messageId: UUID, for contactId: UUID) {
    // 1. 从 conversations 内存中删除
    if var conversation = conversations[contactId] {
        conversation.messages.removeAll { $0.id == messageId }
        conversations[contactId] = conversation
    }
    
    // 2. 从 paginationStates 内存中删除
    if var state = paginationStates[contactId] {
        state.loadedMessages.removeAll { $0.id == messageId }
        state.totalCount = max(0, state.totalCount - 1)
        paginationStates[contactId] = state
    }
    
    // 3. 从持久化存储中删除
    Task {
        do {
            try await cacheService.deleteMessage(messageId: messageId.uuidString)
            logger.info("[ChatsV2] Deleted message: \(messageId)")
            
            // 删除后从缓存刷新列表（更新 messageCount 和 lastMessage）
            await refreshContactsListFromCache()
        } catch {
            logger.error("[ChatsV2] Failed to delete message: \(error)")
            errorMessage = "删除消息失败: \(error.localizedDescription)"
        }
    }
}
```

**设计考虑**:
- 遵循现有的三层同步模式（参考 `updateMessageClassification` 和 `updateMessageSenderName`）
- 同步更新 `totalCount` 避免分页状态不一致
- 调用 `refreshContactsListFromCache()` 确保列表中的 `messageCount` 和 `lastMessage` 正确更新
- 使用 `Task` 异步执行持久化操作，避免阻塞 UI

**验证方式**:
- 编译检查
- 代码审查（确保数据同步逻辑正确）

---

### P3: UI层 - 在右键菜单中添加删除选项

**目标**: 在 `ChatMessageContextMenu` 中添加删除按钮

**文件修改**:
- `Views/Chats/Components/ChatMessageContextMenu.swift`
- `Views/Chats/Components/ChatMessageBubble.swift`
- `Views/Chats/Components/ChatSystemMessageRow.swift`

**实现内容**:

1. **更新 ChatMessageContextMenu**:
   - 添加 `onDelete` 回调参数
   - 在菜单末尾添加删除按钮（使用 `role: .destructive`）

```swift
struct ChatMessageContextMenu: View {
    // ... 现有参数
    let onDelete: () -> Void  // 新增
    
    var body: some View {
        // ... 现有菜单项
        
        Divider()
        
        // 删除按钮（红色，危险操作）
        Button(role: .destructive) {
            onSelect()
            onDelete()
        } label: {
            Label("Delete Message", systemImage: "trash")
        }
    }
}
```

2. **更新 ChatMessageBubble**:
   - 添加 `onDelete` 参数
   - 传递给 `ChatMessageContextMenu`

```swift
struct ChatMessageBubble: View {
    // ... 现有参数
    let onDelete: () -> Void  // 新增
    
    private var bubbleBody: some View {
        // ... 现有代码
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
    }
}
```

3. **更新 ChatSystemMessageRow**:
   - 同样添加 `onDelete` 参数并传递

**验证方式**:
- 编译检查
- UI预览检查（确保菜单显示正确）

---

### P4: UI层 - 在 ChatDetailView 中连接删除功能

**目标**: 在 ChatDetailView 中处理删除回调，调用 ViewModel 方法

**文件修改**:
- `Views/Chats/ChatDetailView.swift`

**实现内容**:

1. 添加删除处理方法:
```swift
// MARK: - Delete Message Handler

private func handleDeleteMessage(_ message: ChatMessage, for contact: ChatBookListItem) {
    listViewModel.deleteMessage(messageId: message.id, for: contact.contactId)
    
    // 清除选中状态（如果删除的是当前选中的消息）
    if selectedMessageId == message.id {
        selectedMessageId = nil
    }
}
```

2. 更新 `ChatMessageBubble` 调用（在 `ForEach` 循环中）:
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
    onDelete: {  // 新增
        handleDeleteMessage(message, for: contact)
    }
)
```

3. 更新 `ChatSystemMessageRow` 调用:
```swift
ChatSystemMessageRow(
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
    onDelete: {  // 新增
        handleDeleteMessage(message, for: contact)
    }
)
```

**验证方式**:
- 编译检查
- 运行应用并测试删除功能

---

### P5: 功能测试与验证

**目标**: 全面测试删除功能，确保数据一致性和边界情况处理

**测试场景**:

1. **基本功能测试**:
   - [ ] 删除普通文本消息
   - [ ] 删除系统消息
   - [ ] 删除带昵称的消息
   - [ ] 删除对话中的最后一条消息
   - [ ] 删除对话中的第一条消息

2. **数据一致性测试**:
   - [ ] 删除后，检查 `paginationStates` 中的 `totalCount` 是否正确减少
   - [ ] 删除后，检查 `conversations` 中的消息列表是否同步
   - [ ] 删除后，检查持久化数据是否删除（重启应用验证）
   - [ ] 删除后，检查左侧列表的 `messageCount` 是否更新
   - [ ] 删除最后一条消息后，检查 `lastMessage` 是否更新为前一条消息

3. **UI状态测试**:
   - [ ] 删除当前选中的消息后，选中状态是否清除
   - [ ] 删除消息后，ScrollView 是否保持在合理位置（不跳动）
   - [ ] 删除消息后，UI 是否平滑更新（无闪烁）

4. **边界情况测试**:
   - [ ] 快速连续删除多条消息
   - [ ] 删除后立即导出对话（确保导出数据正确）
   - [ ] 删除后立即导入新消息（确保 order 顺序正确）
   - [ ] 在分页加载场景下删除消息（只加载了部分消息）

5. **错误处理测试**:
   - [ ] 模拟删除失败场景（检查是否显示错误提示）
   - [ ] 检查日志输出是否正确

**验证方式**:
- 手动测试所有场景
- 截图记录关键状态
- 检查日志输出

---

## 风险评估

### 低风险
- P1-P2: 数据层和业务逻辑层的实现，遵循现有模式，风险低
- P3: UI层菜单添加，不影响现有功能

### 中风险
- P4: UI层集成，需要确保回调链路正确
- 分页状态同步，需要仔细处理 `totalCount` 更新

### 注意事项
1. **不破坏现有功能**: 所有修改都是增量的，不修改现有方法签名（除了添加可选参数）
2. **遵循现有模式**: 参考 `updateMessageClassification` 和 `updateMessageSenderName` 的实现
3. **数据一致性**: 确保三层数据（conversations, paginationStates, cache）同步更新
4. **用户体验**: 删除操作不可逆，使用 `role: .destructive` 标识为危险操作

## 时间估算

- P1: 30 分钟（数据层）
- P2: 45 分钟（业务逻辑层）
- P3: 30 分钟（UI菜单）
- P4: 30 分钟（UI集成）
- P5: 60 分钟（测试验证）

**总计**: 约 3 小时

## 后续优化（可选，不在本次实现范围）

1. **批量删除**: 支持多选删除（需要添加选择模式）
2. **撤销删除**: 添加 undo 功能（需要实现回收站机制）
3. **删除确认**: 添加确认对话框（对于重要消息）
4. **键盘快捷键**: 支持 Delete 键删除选中消息

## 总结

本方案采用自底向上的实现策略（P1→P2→P3→P4→P5），每个优先级完成后都进行验证，确保代码质量。实现过程中严格遵循现有代码风格和架构模式，最小化对现有功能的影响。
