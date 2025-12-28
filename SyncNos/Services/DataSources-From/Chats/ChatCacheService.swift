import Foundation
import SwiftData

// MARK: - Chats Model Container Factory (V2 with Encryption)

/// Chats v2 ModelContainer 工厂（独立 store 文件，支持加密字段）
enum ChatModelContainerFactory {
    static func createContainer() throws -> ModelContainer {
        let schema = Schema([
            CachedChatConversationV2.self,
            CachedChatScreenshotV2.self,
            CachedChatMessageV2.self
        ])

        // 破坏性升级：使用全新 store 文件（v2_encrypted），因为字段类型变更
        // - name -> nameEncrypted (String -> Data)
        // - content -> contentEncrypted (String -> Data)
        // - senderName -> senderNameEncrypted (String? -> Data?)
        let storeURL = URL.applicationSupportDirectory
            .appendingPathComponent("SyncNos", isDirectory: true)
            .appendingPathComponent("chats_v2_encrypted.store")

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

    // 截图导入（持久化 raw OCR + blocks + parsed messages）
    func appendScreenshot(
        conversationId: String,
        screenshotId: String,
        importedAt: Date,
        imageSize: CGSize,
        ocrEngine: String,
        ocrRequestJSON: Data?,
        ocrResponseJSON: Data,
        normalizedBlocksJSON: Data,
        parsedAt: Date,
        messages: [ChatMessage]
    ) throws

    // 清理
    func clearAllData() throws

    // Debug: OCR Payload Inspect
    func fetchRecentOcrPayloads(limit: Int) throws -> [ChatOcrPayloadSummary]
    func fetchOcrPayload(screenshotId: String) throws -> ChatOcrPayloadDetail?
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

    // MARK: Append Screenshot

    func appendScreenshot(
        conversationId: String,
        screenshotId: String,
        importedAt: Date,
        imageSize: CGSize,
        ocrEngine: String,
        ocrRequestJSON: Data?,
        ocrResponseJSON: Data,
        normalizedBlocksJSON: Data,
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
            throw NSError(domain: "ChatCacheV2", code: 404, userInfo: [NSLocalizedDescriptionKey: "对话不存在"])
        }

        // 2) 插入截图记录（raw OCR + blocks）
        let screenshot = CachedChatScreenshotV2(
            screenshotId: screenshotId,
            conversationId: conversationId,
            importedAt: importedAt,
            imageWidth: imageSize.width,
            imageHeight: imageSize.height,
            ocrEngine: ocrEngine,
            ocrRequestJSON: ocrRequestJSON,
            ocrResponseJSON: ocrResponseJSON,
            normalizedBlocksJSON: normalizedBlocksJSON,
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
        logger.info("[ChatCacheV2] Appended screenshot(\(screenshotId)) + \(messages.count) messages")
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
        logger.info("[ChatCacheV2] Cleared all data")
    }

    // MARK: Debug - OCR Payload Inspect

    func fetchRecentOcrPayloads(limit: Int) throws -> [ChatOcrPayloadSummary] {
        var descriptor = FetchDescriptor<CachedChatScreenshotV2>(
            sortBy: [SortDescriptor(\.importedAt, order: .reverse)]
        )
        descriptor.fetchLimit = max(0, limit)

        let screenshots = try modelContext.fetch(descriptor)
        return screenshots.map {
            ChatOcrPayloadSummary(
                screenshotId: $0.screenshotId,
                conversationId: $0.conversationId,
                importedAt: $0.importedAt,
                parsedAt: $0.parsedAt,
                responseBytes: $0.ocrResponseJSON.count,
                blocksBytes: $0.normalizedBlocksJSON.count
            )
        }
    }

    func fetchOcrPayload(screenshotId: String) throws -> ChatOcrPayloadDetail? {
        let targetId = screenshotId
        let predicate = #Predicate<CachedChatScreenshotV2> { shot in
            shot.screenshotId == targetId
        }
        var descriptor = FetchDescriptor<CachedChatScreenshotV2>(predicate: predicate)
        descriptor.fetchLimit = 1

        guard let shot = try modelContext.fetch(descriptor).first else { return nil }

        return ChatOcrPayloadDetail(
            screenshotId: shot.screenshotId,
            conversationId: shot.conversationId,
            importedAt: shot.importedAt,
            parsedAt: shot.parsedAt,
            requestJSON: shot.ocrRequestJSON.flatMap { String(data: $0, encoding: .utf8) },
            responseJSON: String(data: shot.ocrResponseJSON, encoding: .utf8) ?? "<non-utf8 data>",
            normalizedBlocksJSON: String(data: shot.normalizedBlocksJSON, encoding: .utf8) ?? "<non-utf8 data>"
        )
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

// MARK: - Debug DTOs (Sendable)

struct ChatOcrPayloadSummary: Identifiable, Hashable, Sendable {
    var id: String { screenshotId }

    let screenshotId: String
    let conversationId: String
    let importedAt: Date
    let parsedAt: Date
    let responseBytes: Int
    let blocksBytes: Int
}

struct ChatOcrPayloadDetail: Sendable {
    let screenshotId: String
    let conversationId: String
    let importedAt: Date
    let parsedAt: Date
    let requestJSON: String?
    let responseJSON: String
    let normalizedBlocksJSON: String
}


