import Foundation
import SwiftData

// MARK: - Chats Model Container Factory (V3 Minimal)

/// Chats v3 ModelContainer 工厂（独立 store 文件，支持加密字段，不存储 OCR JSON）
///
/// **V3 变更（2025-12-30）**：
/// - 删除 `ocrRequestJSON`、`ocrResponseJSON`、`normalizedBlocksJSON` 字段
/// - 使用新 store 文件 `chats_v3_minimal.store`（破坏性升级，用户需重新导入）
enum ChatModelContainerFactory {
    static func createContainer() throws -> ModelContainer {
        let schema = Schema([
            CachedChatConversationV2.self,
            CachedChatScreenshotV2.self,
            CachedChatMessageV2.self
        ])

        // 破坏性升级：使用全新 store 文件（v3_minimal），因为 Schema 变更
        // - 删除 CachedChatScreenshotV2 的 ocrRequestJSON, ocrResponseJSON, normalizedBlocksJSON
        let storeURL = URL.applicationSupportDirectory
            .appendingPathComponent("SyncNos", isDirectory: true)
            .appendingPathComponent("chats_v3_minimal.store")

        // 确保目录存在
        let directory = storeURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let modelConfiguration = ModelConfiguration(
            schema: schema,
            url: storeURL,
            allowsSave: true
        )

        return try ModelContainer(
            for: schema,
            configurations: [modelConfiguration]
        )
    }
}

// MARK: - Chats Cache Service Protocol (V2)

protocol ChatCacheServiceProtocol: Actor {
    // 对话管理
    func fetchAllConversations() throws -> [ChatBookListItem]
    func saveConversation(_ contact: ChatContact) throws
    func deleteConversation(id: String) throws
    func renameConversation(id: String, newName: String) throws

    // 消息读取（全量，保留兼容）
    func fetchMessages(conversationId: String) throws -> [ChatMessage]
    
    // 消息读取（全量，按 order 升序，用于导出）
    func fetchAllMessages(conversationId: String) throws -> [ChatMessage]
    
    // 消息分页读取（倒序分页：从最新消息开始）
    /// - Parameters:
    ///   - conversationId: 对话 ID
    ///   - limit: 每页数量
    ///   - offset: 偏移量（从最新消息开始计算）
    /// - Returns: 消息列表（按 order 升序，即时间正序）
    func fetchMessagesPage(
        conversationId: String,
        limit: Int,
        offset: Int
    ) throws -> [ChatMessage]
    
    /// 获取对话消息总数
    func fetchMessageCount(conversationId: String) throws -> Int
    
    // 消息分类更新
    func updateMessageClassification(
        messageId: String,
        isFromMe: Bool,
        kind: ChatMessageKind
    ) throws
    
    // 消息昵称更新
    func updateMessageSenderName(
        messageId: String,
        senderName: String?
    ) throws
    
    // 消息删除
    func deleteMessage(messageId: String) throws
    func deleteMessages(messageIds: [String]) throws

    // 截图导入（持久化元数据 + parsed messages，不存储 OCR 原始数据）
    func appendScreenshot(
        conversationId: String,
        screenshotId: String,
        importedAt: Date,
        imageSize: CGSize,
        ocrEngine: String,
        parsedAt: Date,
        messages: [ChatMessage]
    ) throws

    // 清理
    func clearAllData() throws
}

// MARK: - Chats Cache Service (V2)

@ModelActor
actor ChatCacheService: ChatCacheServiceProtocol {
    // 注意：@ModelActor 不能有存储属性
    private var logger: LoggerServiceProtocol {
        DIContainer.shared.loggerService
    }

    // MARK: Conversation

    func fetchAllConversations() throws -> [ChatBookListItem] {
        let descriptor = FetchDescriptor<CachedChatConversationV2>(
            sortBy: [SortDescriptor(\.updatedAt, order: .reverse)]
        )
        let conversations = try modelContext.fetch(descriptor)

        var items: [ChatBookListItem] = []
        items.reserveCapacity(conversations.count)

        for conv in conversations {
            let convId = conv.conversationId

            let msgPredicate = #Predicate<CachedChatMessageV2> { msg in
                msg.conversationId == convId
            }

            // 消息数量（仅气泡消息）
            let count = try modelContext.fetchCount(FetchDescriptor<CachedChatMessageV2>(predicate: msgPredicate))

            // 最后一条消息
            var lastDescriptor = FetchDescriptor<CachedChatMessageV2>(
                predicate: msgPredicate,
                sortBy: [SortDescriptor(\.order, order: .reverse)]
            )
            lastDescriptor.fetchLimit = 1
            let lastMessage = try modelContext.fetch(lastDescriptor).first

            let contact = ChatContact(
                id: UUID(uuidString: conv.conversationId) ?? UUID(),
                name: conv.name,
                lastMessage: lastMessage?.content,
                lastMessageTime: nil,
                messageCount: count
            )
            items.append(ChatBookListItem(from: contact))
        }

        return items
    }

    func saveConversation(_ contact: ChatContact) throws {
        let targetId = contact.id.uuidString
        let predicate = #Predicate<CachedChatConversationV2> { conv in
            conv.conversationId == targetId
        }
        var descriptor = FetchDescriptor<CachedChatConversationV2>(predicate: predicate)
        descriptor.fetchLimit = 1

        if let existing = try modelContext.fetch(descriptor).first {
            try existing.updateName(contact.name)  // 加密更新
        } else {
            let newConversation = try CachedChatConversationV2(
                conversationId: targetId,
                name: contact.name,  // 自动加密
                createdAt: Date(),
                updatedAt: Date()
            )
            modelContext.insert(newConversation)
        }

        try modelContext.save()
        logger.info("[ChatCacheV2] Saved conversation: \(contact.name)")
    }

    func deleteConversation(id: String) throws {
        let targetId = id
        let predicate = #Predicate<CachedChatConversationV2> { conv in
            conv.conversationId == targetId
        }
        var descriptor = FetchDescriptor<CachedChatConversationV2>(predicate: predicate)
        descriptor.fetchLimit = 1

        if let conv = try modelContext.fetch(descriptor).first {
            modelContext.delete(conv)
            try modelContext.save()
            logger.info("[ChatCacheV2] Deleted conversation: \(id)")
        }
    }

    func renameConversation(id: String, newName: String) throws {
        let targetId = id
        let predicate = #Predicate<CachedChatConversationV2> { conv in
            conv.conversationId == targetId
        }
        var descriptor = FetchDescriptor<CachedChatConversationV2>(predicate: predicate)
        descriptor.fetchLimit = 1

        if let conv = try modelContext.fetch(descriptor).first {
            try conv.updateName(newName)  // 加密更新
            try modelContext.save()
            logger.info("[ChatCacheV2] Renamed conversation to: \(newName)")
        }
    }

    // MARK: Messages

    func fetchMessages(conversationId: String) throws -> [ChatMessage] {
        let targetId = conversationId
        let predicate = #Predicate<CachedChatMessageV2> { msg in
            msg.conversationId == targetId
        }
        let descriptor = FetchDescriptor<CachedChatMessageV2>(
            predicate: predicate,
            sortBy: [SortDescriptor(\.order, order: .forward)]
        )
        let cached = try modelContext.fetch(descriptor)
        return cached.map { $0.toChatMessage() }
    }
    
    // MARK: Paginated Messages
    
    func fetchMessagesPage(
        conversationId: String,
        limit: Int,
        offset: Int
    ) throws -> [ChatMessage] {
        let targetId = conversationId
        let predicate = #Predicate<CachedChatMessageV2> { msg in
            msg.conversationId == targetId
        }
        
        // 倒序查询：从最新消息开始（order DESC）
        var descriptor = FetchDescriptor<CachedChatMessageV2>(
            predicate: predicate,
            sortBy: [SortDescriptor(\.order, order: .reverse)]
        )
        descriptor.fetchLimit = limit
        descriptor.fetchOffset = offset
        
        let cached = try modelContext.fetch(descriptor)
        
        // 反转结果为正序（order ASC），符合聊天界面展示习惯
        let messages = cached.reversed().map { $0.toChatMessage() }
        return Array(messages)
    }
    
    func fetchAllMessages(conversationId: String) throws -> [ChatMessage] {
        let targetId = conversationId
        let predicate = #Predicate<CachedChatMessageV2> { msg in
            msg.conversationId == targetId
        }
        
        let descriptor = FetchDescriptor<CachedChatMessageV2>(
            predicate: predicate,
            sortBy: [SortDescriptor(\.order, order: .forward)]
        )
        
        let cached = try modelContext.fetch(descriptor)
        return cached.map { $0.toChatMessage() }
    }
    
    func fetchMessageCount(conversationId: String) throws -> Int {
        let targetId = conversationId
        let predicate = #Predicate<CachedChatMessageV2> { msg in
            msg.conversationId == targetId
        }
        let descriptor = FetchDescriptor<CachedChatMessageV2>(predicate: predicate)
        return try modelContext.fetchCount(descriptor)
    }
    
    // MARK: Update Message Classification
    
    func updateMessageClassification(
        messageId: String,
        isFromMe: Bool,
        kind: ChatMessageKind
    ) throws {
        let targetId = messageId
        let predicate = #Predicate<CachedChatMessageV2> { msg in
            msg.messageId == targetId
        }
        var descriptor = FetchDescriptor<CachedChatMessageV2>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        guard let message = try modelContext.fetch(descriptor).first else {
            logger.warning("[ChatCacheV2] Message not found for update: \(messageId)")
            return
        }
        
        message.isFromMe = isFromMe
        message.kindRaw = kind.rawValue
        
        try modelContext.save()
        logger.info("[ChatCacheV2] Updated message classification: \(messageId) -> isFromMe=\(isFromMe), kind=\(kind.rawValue)")
    }
    
    // MARK: Update Message Sender Name
    
    func updateMessageSenderName(
        messageId: String,
        senderName: String?
    ) throws {
        let targetId = messageId
        let predicate = #Predicate<CachedChatMessageV2> { msg in
            msg.messageId == targetId
        }
        var descriptor = FetchDescriptor<CachedChatMessageV2>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        guard let message = try modelContext.fetch(descriptor).first else {
            logger.warning("[ChatCacheV2] Message not found for sender name update: \(messageId)")
            return
        }
        
        try message.updateSenderName(senderName)
        
        try modelContext.save()
        logger.info("[ChatCacheV2] Updated message sender name: \(messageId) -> \(senderName ?? "nil")")
    }
    
    // MARK: Delete Message
    
    func deleteMessage(messageId: String) throws {
        let targetId = messageId
        let predicate = #Predicate<CachedChatMessageV2> { msg in
            msg.messageId == targetId
        }
        var descriptor = FetchDescriptor<CachedChatMessageV2>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        guard let message = try modelContext.fetch(descriptor).first else {
            logger.warning("[ChatCacheV2] Message not found for deletion: \(messageId)")
            return
        }
        
        modelContext.delete(message)
        try modelContext.save()
        logger.info("[ChatCacheV2] Deleted message: \(messageId)")
    }
    
    func deleteMessages(messageIds: [String]) throws {
        guard !messageIds.isEmpty else { return }
        
        // 批量删除
        let targetIds = messageIds
        let predicate = #Predicate<CachedChatMessageV2> { msg in
            targetIds.contains(msg.messageId)
        }
        let descriptor = FetchDescriptor<CachedChatMessageV2>(predicate: predicate)
        
        let messages = try modelContext.fetch(descriptor)
        for message in messages {
            modelContext.delete(message)
        }
        
        try modelContext.save()
        logger.info("[ChatCacheV2] Deleted \(messages.count) messages")
    }

    // MARK: Append Screenshot

    func appendScreenshot(
        conversationId: String,
        screenshotId: String,
        importedAt: Date,
        imageSize: CGSize,
        ocrEngine: String,
        parsedAt: Date,
        messages: [ChatMessage]
    ) throws {
        // 1) 确保对话存在
        let targetConvId = conversationId
        let convPredicate = #Predicate<CachedChatConversationV2> { conv in
            conv.conversationId == targetConvId
        }
        var convDescriptor = FetchDescriptor<CachedChatConversationV2>(predicate: convPredicate)
        convDescriptor.fetchLimit = 1

        guard let conversation = try modelContext.fetch(convDescriptor).first else {
            throw NSError(domain: "ChatCacheV3", code: 404, userInfo: [NSLocalizedDescriptionKey: "对话不存在"])
        }

        // 2) 插入截图记录（仅元数据，不存储 OCR 原始数据）
        let screenshot = CachedChatScreenshotV2(
            screenshotId: screenshotId,
            conversationId: conversationId,
            importedAt: importedAt,
            imageWidth: imageSize.width,
            imageHeight: imageSize.height,
            ocrEngine: ocrEngine,
            parsedAt: parsedAt
        )
        screenshot.conversation = conversation
        modelContext.insert(screenshot)

        // 3) 计算当前对话最大 order
        let msgPredicate = #Predicate<CachedChatMessageV2> { msg in
            msg.conversationId == targetConvId
        }
        var lastMsgDescriptor = FetchDescriptor<CachedChatMessageV2>(
            predicate: msgPredicate,
            sortBy: [SortDescriptor(\.order, order: .reverse)]
        )
        lastMsgDescriptor.fetchLimit = 1
        let maxOrder = (try modelContext.fetch(lastMsgDescriptor).first?.order) ?? -1

        // 4) 插入消息（加密存储）
        for (index, message) in messages.enumerated() {
            let cachedMessage = try CachedChatMessageV2(
                messageId: message.id.uuidString,
                conversationId: conversationId,
                screenshotId: screenshotId,
                content: message.content,        // 自动加密
                isFromMe: message.isFromMe,
                senderName: message.senderName,  // 自动加密（如有）
                kind: message.kind,
                order: maxOrder + 1 + index,
                bbox: message.bbox
            )
            cachedMessage.conversation = conversation
            modelContext.insert(cachedMessage)
        }

        // 5) 更新 updatedAt
        conversation.updatedAt = Date()

        try modelContext.save()
        logger.info("[ChatCacheV3] Appended screenshot(\(screenshotId)) + \(messages.count) messages")
    }

    // MARK: Cleanup

    func clearAllData() throws {
        // 删除所有消息
        let msgDescriptor = FetchDescriptor<CachedChatMessageV2>()
        for msg in try modelContext.fetch(msgDescriptor) {
            modelContext.delete(msg)
        }

        // 删除所有截图
        let screenshotDescriptor = FetchDescriptor<CachedChatScreenshotV2>()
        for shot in try modelContext.fetch(screenshotDescriptor) {
            modelContext.delete(shot)
        }

        // 删除所有对话
        let convDescriptor = FetchDescriptor<CachedChatConversationV2>()
        for conv in try modelContext.fetch(convDescriptor) {
            modelContext.delete(conv)
        }

        try modelContext.save()
        logger.info("[ChatCacheV3] Cleared all data")
    }
}

// MARK: - Conversion

private extension CachedChatMessageV2 {
    func toChatMessage() -> ChatMessage {
        ChatMessage(
            id: UUID(uuidString: messageId) ?? UUID(),
            content: content,
            isFromMe: isFromMe,
            senderName: senderName,
            kind: kind,
            bbox: bbox,
            order: order
        )
    }
}

// MARK: - Deprecated: Debug DTOs
//
// ChatOcrPayloadSummary 和 ChatOcrPayloadDetail 已移除（2025-12-30）
// - OCR 原始数据不再持久化
// - 调试功能已移除


