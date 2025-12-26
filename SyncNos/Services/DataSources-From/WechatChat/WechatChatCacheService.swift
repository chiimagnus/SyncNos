import Foundation
import SwiftData
import AppKit

// MARK: - WechatChat Model Container Factory (V2 with Encryption)

/// WechatChat v2 ModelContainer 工厂（独立 store 文件，支持加密字段）
enum WechatChatModelContainerFactory {
    static func createContainer() throws -> ModelContainer {
        let schema = Schema([
            CachedWechatConversationV2.self,
            CachedWechatScreenshotV2.self,
            CachedWechatMessageV2.self
        ])

        // 破坏性升级：使用全新 store 文件（v2_encrypted），因为字段类型变更
        // - name -> nameEncrypted (String -> Data)
        // - content -> contentEncrypted (String -> Data)
        // - senderName -> senderNameEncrypted (String? -> Data?)
        let storeURL = URL.applicationSupportDirectory
            .appendingPathComponent("SyncNos", isDirectory: true)
            .appendingPathComponent("wechatchat_v2_encrypted.store")

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

// MARK: - WechatChat Cache Service Protocol (V2)

protocol WechatChatCacheServiceProtocol: Actor {
    // 对话管理
    func fetchAllConversations() throws -> [WechatBookListItem]
    func saveConversation(_ contact: WechatContact) throws
    func deleteConversation(id: String) throws
    func renameConversation(id: String, newName: String) throws

    // 消息读取（全量，保留兼容）
    func fetchMessages(conversationId: String) throws -> [WechatMessage]
    
    // 消息读取（全量，按 order 升序，用于导出）
    func fetchAllMessages(conversationId: String) throws -> [WechatMessage]
    
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
    ) throws -> [WechatMessage]
    
    /// 获取对话消息总数
    func fetchMessageCount(conversationId: String) throws -> Int
    
    // 消息分类更新
    func updateMessageClassification(
        messageId: String,
        isFromMe: Bool,
        kind: WechatMessageKind
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
        messages: [WechatMessage]
    ) throws

    // 清理
    func clearAllData() throws

    // Debug: OCR Payload Inspect
    func fetchRecentOcrPayloads(limit: Int) throws -> [WechatOcrPayloadSummary]
    func fetchOcrPayload(screenshotId: String) throws -> WechatOcrPayloadDetail?
}

// MARK: - WechatChat Cache Service (V2)

@ModelActor
actor WechatChatCacheService: WechatChatCacheServiceProtocol {
    // 注意：@ModelActor 不能有存储属性
    private var logger: LoggerServiceProtocol {
        DIContainer.shared.loggerService
    }

    // MARK: Conversation

    func fetchAllConversations() throws -> [WechatBookListItem] {
        let descriptor = FetchDescriptor<CachedWechatConversationV2>(
            sortBy: [SortDescriptor(\.updatedAt, order: .reverse)]
        )
        let conversations = try modelContext.fetch(descriptor)

        var items: [WechatBookListItem] = []
        items.reserveCapacity(conversations.count)

        for conv in conversations {
            let convId = conv.conversationId

            let msgPredicate = #Predicate<CachedWechatMessageV2> { msg in
                msg.conversationId == convId
            }

            // 消息数量（仅气泡消息）
            let count = try modelContext.fetchCount(FetchDescriptor<CachedWechatMessageV2>(predicate: msgPredicate))

            // 最后一条消息
            var lastDescriptor = FetchDescriptor<CachedWechatMessageV2>(
                predicate: msgPredicate,
                sortBy: [SortDescriptor(\.order, order: .reverse)]
            )
            lastDescriptor.fetchLimit = 1
            let lastMessage = try modelContext.fetch(lastDescriptor).first

            let contact = WechatContact(
                id: UUID(uuidString: conv.conversationId) ?? UUID(),
                name: conv.name,
                lastMessage: lastMessage?.content,
                lastMessageTime: nil,
                messageCount: count
            )
            items.append(WechatBookListItem(from: contact))
        }

        return items
    }

    func saveConversation(_ contact: WechatContact) throws {
        let targetId = contact.id.uuidString
        let predicate = #Predicate<CachedWechatConversationV2> { conv in
            conv.conversationId == targetId
        }
        var descriptor = FetchDescriptor<CachedWechatConversationV2>(predicate: predicate)
        descriptor.fetchLimit = 1

        if let existing = try modelContext.fetch(descriptor).first {
            try existing.updateName(contact.name)  // 加密更新
        } else {
            let newConversation = try CachedWechatConversationV2(
                conversationId: targetId,
                name: contact.name,  // 自动加密
                createdAt: Date(),
                updatedAt: Date()
            )
            modelContext.insert(newConversation)
        }

        try modelContext.save()
        logger.info("[WechatChatCacheV2] Saved conversation: \(contact.name)")
    }

    func deleteConversation(id: String) throws {
        let targetId = id
        let predicate = #Predicate<CachedWechatConversationV2> { conv in
            conv.conversationId == targetId
        }
        var descriptor = FetchDescriptor<CachedWechatConversationV2>(predicate: predicate)
        descriptor.fetchLimit = 1

        if let conv = try modelContext.fetch(descriptor).first {
            modelContext.delete(conv)
            try modelContext.save()
            logger.info("[WechatChatCacheV2] Deleted conversation: \(id)")
        }
    }

    func renameConversation(id: String, newName: String) throws {
        let targetId = id
        let predicate = #Predicate<CachedWechatConversationV2> { conv in
            conv.conversationId == targetId
        }
        var descriptor = FetchDescriptor<CachedWechatConversationV2>(predicate: predicate)
        descriptor.fetchLimit = 1

        if let conv = try modelContext.fetch(descriptor).first {
            try conv.updateName(newName)  // 加密更新
            try modelContext.save()
            logger.info("[WechatChatCacheV2] Renamed conversation to: \(newName)")
        }
    }

    // MARK: Messages

    func fetchMessages(conversationId: String) throws -> [WechatMessage] {
        let targetId = conversationId
        let predicate = #Predicate<CachedWechatMessageV2> { msg in
            msg.conversationId == targetId
        }
        let descriptor = FetchDescriptor<CachedWechatMessageV2>(
            predicate: predicate,
            sortBy: [SortDescriptor(\.order, order: .forward)]
        )
        let cached = try modelContext.fetch(descriptor)
        return cached.map { $0.toWechatMessage() }
    }
    
    // MARK: Paginated Messages
    
    func fetchMessagesPage(
        conversationId: String,
        limit: Int,
        offset: Int
    ) throws -> [WechatMessage] {
        let targetId = conversationId
        let predicate = #Predicate<CachedWechatMessageV2> { msg in
            msg.conversationId == targetId
        }
        
        // 倒序查询：从最新消息开始（order DESC）
        var descriptor = FetchDescriptor<CachedWechatMessageV2>(
            predicate: predicate,
            sortBy: [SortDescriptor(\.order, order: .reverse)]
        )
        descriptor.fetchLimit = limit
        descriptor.fetchOffset = offset
        
        let cached = try modelContext.fetch(descriptor)
        
        // 反转结果为正序（order ASC），符合聊天界面展示习惯
        let messages = cached.reversed().map { $0.toWechatMessage() }
        return Array(messages)
    }
    
    func fetchAllMessages(conversationId: String) throws -> [WechatMessage] {
        let targetId = conversationId
        let predicate = #Predicate<CachedWechatMessageV2> { msg in
            msg.conversationId == targetId
        }
        
        let descriptor = FetchDescriptor<CachedWechatMessageV2>(
            predicate: predicate,
            sortBy: [SortDescriptor(\.order, order: .forward)]
        )
        
        let cached = try modelContext.fetch(descriptor)
        return cached.map { $0.toWechatMessage() }
    }
    
    func fetchMessageCount(conversationId: String) throws -> Int {
        let targetId = conversationId
        let predicate = #Predicate<CachedWechatMessageV2> { msg in
            msg.conversationId == targetId
        }
        let descriptor = FetchDescriptor<CachedWechatMessageV2>(predicate: predicate)
        return try modelContext.fetchCount(descriptor)
    }
    
    // MARK: Update Message Classification
    
    func updateMessageClassification(
        messageId: String,
        isFromMe: Bool,
        kind: WechatMessageKind
    ) throws {
        let targetId = messageId
        let predicate = #Predicate<CachedWechatMessageV2> { msg in
            msg.messageId == targetId
        }
        var descriptor = FetchDescriptor<CachedWechatMessageV2>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        guard let message = try modelContext.fetch(descriptor).first else {
            logger.warning("[WechatChatCacheV2] Message not found for update: \(messageId)")
            return
        }
        
        message.isFromMe = isFromMe
        message.kindRaw = kind.rawValue
        
        try modelContext.save()
        logger.info("[WechatChatCacheV2] Updated message classification: \(messageId) -> isFromMe=\(isFromMe), kind=\(kind.rawValue)")
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
        messages: [WechatMessage]
    ) throws {
        // 1) 确保对话存在
        let targetConvId = conversationId
        let convPredicate = #Predicate<CachedWechatConversationV2> { conv in
            conv.conversationId == targetConvId
        }
        var convDescriptor = FetchDescriptor<CachedWechatConversationV2>(predicate: convPredicate)
        convDescriptor.fetchLimit = 1

        guard let conversation = try modelContext.fetch(convDescriptor).first else {
            throw NSError(domain: "WechatChatCacheV2", code: 404, userInfo: [NSLocalizedDescriptionKey: "对话不存在"])
        }

        // 2) 插入截图记录（raw OCR + blocks）
        let screenshot = CachedWechatScreenshotV2(
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
        let msgPredicate = #Predicate<CachedWechatMessageV2> { msg in
            msg.conversationId == targetConvId
        }
        var lastMsgDescriptor = FetchDescriptor<CachedWechatMessageV2>(
            predicate: msgPredicate,
            sortBy: [SortDescriptor(\.order, order: .reverse)]
        )
        lastMsgDescriptor.fetchLimit = 1
        let maxOrder = (try modelContext.fetch(lastMsgDescriptor).first?.order) ?? -1

        // 4) 插入消息（加密存储）
        for (index, message) in messages.enumerated() {
            let cachedMessage = try CachedWechatMessageV2(
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
        logger.info("[WechatChatCacheV2] Appended screenshot(\(screenshotId)) + \(messages.count) messages")
    }

    // MARK: Cleanup

    func clearAllData() throws {
        // 删除所有消息
        let msgDescriptor = FetchDescriptor<CachedWechatMessageV2>()
        for msg in try modelContext.fetch(msgDescriptor) {
            modelContext.delete(msg)
        }

        // 删除所有截图
        let screenshotDescriptor = FetchDescriptor<CachedWechatScreenshotV2>()
        for shot in try modelContext.fetch(screenshotDescriptor) {
            modelContext.delete(shot)
        }

        // 删除所有对话
        let convDescriptor = FetchDescriptor<CachedWechatConversationV2>()
        for conv in try modelContext.fetch(convDescriptor) {
            modelContext.delete(conv)
        }

        try modelContext.save()
        logger.info("[WechatChatCacheV2] Cleared all data")
    }

    // MARK: Debug - OCR Payload Inspect

    func fetchRecentOcrPayloads(limit: Int) throws -> [WechatOcrPayloadSummary] {
        var descriptor = FetchDescriptor<CachedWechatScreenshotV2>(
            sortBy: [SortDescriptor(\.importedAt, order: .reverse)]
        )
        descriptor.fetchLimit = max(0, limit)

        let screenshots = try modelContext.fetch(descriptor)
        return screenshots.map {
            WechatOcrPayloadSummary(
                screenshotId: $0.screenshotId,
                conversationId: $0.conversationId,
                importedAt: $0.importedAt,
                parsedAt: $0.parsedAt,
                responseBytes: $0.ocrResponseJSON.count,
                blocksBytes: $0.normalizedBlocksJSON.count
            )
        }
    }

    func fetchOcrPayload(screenshotId: String) throws -> WechatOcrPayloadDetail? {
        let targetId = screenshotId
        let predicate = #Predicate<CachedWechatScreenshotV2> { shot in
            shot.screenshotId == targetId
        }
        var descriptor = FetchDescriptor<CachedWechatScreenshotV2>(predicate: predicate)
        descriptor.fetchLimit = 1

        guard let shot = try modelContext.fetch(descriptor).first else { return nil }

        return WechatOcrPayloadDetail(
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

private extension CachedWechatMessageV2 {
    func toWechatMessage() -> WechatMessage {
        WechatMessage(
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

struct WechatOcrPayloadSummary: Identifiable, Hashable, Sendable {
    var id: String { screenshotId }

    let screenshotId: String
    let conversationId: String
    let importedAt: Date
    let parsedAt: Date
    let responseBytes: Int
    let blocksBytes: Int
}

struct WechatOcrPayloadDetail: Sendable {
    let screenshotId: String
    let conversationId: String
    let importedAt: Date
    let parsedAt: Date
    let requestJSON: String?
    let responseJSON: String
    let normalizedBlocksJSON: String
}


