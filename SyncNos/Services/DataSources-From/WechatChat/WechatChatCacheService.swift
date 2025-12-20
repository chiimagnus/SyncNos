import Foundation
import SwiftData
import AppKit

// MARK: - Wechat Chat Model Container Factory

/// WechatChat ModelContainer 工厂
/// 负责创建和管理 WechatChat 专用的 ModelContainer
enum WechatChatModelContainerFactory {
    /// 创建 WechatChat 专用的 ModelContainer
    static func createContainer() throws -> ModelContainer {
        let schema = Schema([
            CachedWechatConversation.self,
            CachedWechatMessage.self,
            CachedWechatScreenshotMeta.self
        ])
        
        // 使用独立的存储文件，避免与其他 ModelContainer 冲突
        let storeURL = URL.applicationSupportDirectory
            .appendingPathComponent("SyncNos", isDirectory: true)
            .appendingPathComponent("wechatchat.store")
        
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

// MARK: - Wechat Chat Cache Service Protocol

/// WechatChat 本地缓存服务协议
/// 继承自 Actor 以支持 @ModelActor 实现
protocol WechatChatCacheServiceProtocol: Actor {
    // 对话管理
    func fetchAllConversations() throws -> [WechatBookListItem]
    func fetchConversation(id: String) throws -> WechatConversation?
    func saveConversation(_ contact: WechatContact) throws
    func deleteConversation(id: String) throws
    func renameConversation(id: String, newName: String) throws
    
    // 消息管理
    func fetchMessages(conversationId: String) throws -> [WechatMessage]
    func saveMessages(_ messages: [WechatMessage], conversationId: String, screenshotId: String) throws
    
    // 截图元数据
    func saveScreenshotMeta(_ screenshot: WechatScreenshot, conversationId: String) throws
    
    // 清理
    func clearAllData() throws
}

// MARK: - Wechat Chat Cache Service

/// WechatChat 本地数据存储服务实现
/// 使用 @ModelActor 在后台线程执行所有数据库操作，不阻塞主线程
@ModelActor
actor WechatChatCacheService: WechatChatCacheServiceProtocol {
    // 注意：@ModelActor 宏会自动生成 modelExecutor、modelContainer 和 init(modelContainer:)
    // 不能添加额外的存储属性，否则会导致初始化器冲突
    
    // 使用全局 logger 而不是存储属性
    private var logger: LoggerServiceProtocol {
        DIContainer.shared.loggerService
    }
    
    // MARK: - Conversation Management
    
    /// 获取所有对话列表
    func fetchAllConversations() throws -> [WechatBookListItem] {
        let descriptor = FetchDescriptor<CachedWechatConversation>(
            sortBy: [SortDescriptor(\.updatedAt, order: .reverse)]
        )
        let conversations = try modelContext.fetch(descriptor)
        return conversations.map { WechatBookListItem(from: $0) }
    }
    
    /// 获取单个对话详情
    func fetchConversation(id: String) throws -> WechatConversation? {
        let targetId = id
        let predicate = #Predicate<CachedWechatConversation> { conv in
            conv.conversationId == targetId
        }
        var descriptor = FetchDescriptor<CachedWechatConversation>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        guard let cached = try modelContext.fetch(descriptor).first else {
            return nil
        }
        
        let contact = WechatContact(from: cached)
        let messages = try fetchMessages(conversationId: id)
        
        // 创建对话（不包含原始截图图像，只有消息）
        var conversation = WechatConversation(contact: contact, screenshots: [])
        
        // 创建一个虚拟截图来承载消息（使用空白图像）
        if !messages.isEmpty {
            let placeholderImage = NSImage(size: NSSize(width: 1, height: 1))
            let screenshot = WechatScreenshot(
                image: placeholderImage,
                contactName: contact.name,
                messages: messages,
                isProcessing: false
            )
            conversation.screenshots = [screenshot]
        }
        
        return conversation
    }
    
    /// 保存对话
    func saveConversation(_ contact: WechatContact) throws {
        let targetId = contact.id.uuidString
        let predicate = #Predicate<CachedWechatConversation> { conv in
            conv.conversationId == targetId
        }
        var descriptor = FetchDescriptor<CachedWechatConversation>(predicate: predicate)
        descriptor.fetchLimit = 1
        let existing = try modelContext.fetch(descriptor).first
        
        if let existing {
            // 更新现有记录
            existing.name = contact.name
            existing.isGroup = contact.isGroup
            existing.updatedAt = Date()
        } else {
            // 创建新记录
            let newConversation = CachedWechatConversation(from: contact)
            modelContext.insert(newConversation)
        }
        
        try modelContext.save()
        logger.info("[WechatChatCache] Saved conversation: \(contact.name)")
    }
    
    /// 删除对话
    func deleteConversation(id: String) throws {
        let targetId = id
        let predicate = #Predicate<CachedWechatConversation> { conv in
            conv.conversationId == targetId
        }
        var descriptor = FetchDescriptor<CachedWechatConversation>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        if let conversation = try modelContext.fetch(descriptor).first {
            modelContext.delete(conversation)
            try modelContext.save()
            logger.info("[WechatChatCache] Deleted conversation: \(id)")
        }
    }
    
    /// 重命名对话
    func renameConversation(id: String, newName: String) throws {
        let targetId = id
        let predicate = #Predicate<CachedWechatConversation> { conv in
            conv.conversationId == targetId
        }
        var descriptor = FetchDescriptor<CachedWechatConversation>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        if let conversation = try modelContext.fetch(descriptor).first {
            conversation.name = newName
            conversation.updatedAt = Date()
            try modelContext.save()
            logger.info("[WechatChatCache] Renamed conversation to: \(newName)")
        }
    }
    
    // MARK: - Message Management
    
    /// 获取对话的所有消息
    func fetchMessages(conversationId: String) throws -> [WechatMessage] {
        let targetConvId = conversationId
        let predicate = #Predicate<CachedWechatMessage> { msg in
            msg.conversationId == targetConvId
        }
        let descriptor = FetchDescriptor<CachedWechatMessage>(
            predicate: predicate,
            sortBy: [SortDescriptor(\.blockOrder)]
        )
        let cached = try modelContext.fetch(descriptor)
        return cached.map { $0.toWechatMessage() }
    }
    
    /// 保存消息
    func saveMessages(_ messages: [WechatMessage], conversationId: String, screenshotId: String) throws {
        // 获取当前对话已有消息的最大 blockOrder
        let targetConvId = conversationId
        let existingPredicate = #Predicate<CachedWechatMessage> { msg in
            msg.conversationId == targetConvId
        }
        let existingDescriptor = FetchDescriptor<CachedWechatMessage>(
            predicate: existingPredicate,
            sortBy: [SortDescriptor(\.blockOrder, order: .reverse)]
        )
        let existingMessages = try modelContext.fetch(existingDescriptor)
        let maxOrder = existingMessages.first?.blockOrder ?? -1
        
        // 保存新消息，调整 blockOrder
        for (index, message) in messages.enumerated() {
            // 使用原始 blockOrder，但加上偏移量以保持顺序
            let newBlockOrder = maxOrder + 1 + index
            
            let cachedMessage = CachedWechatMessage(
                messageId: message.id.uuidString,
                conversationId: conversationId,
                screenshotId: screenshotId,
                content: message.content,
                isFromMe: message.isFromMe,
                senderName: message.senderName,
                type: message.type,
                blockOrder: newBlockOrder,
                bbox: message.bbox
            )
            modelContext.insert(cachedMessage)
        }
        
        // 更新对话的 updatedAt
        let convPredicate = #Predicate<CachedWechatConversation> { conv in
            conv.conversationId == targetConvId
        }
        var convDescriptor = FetchDescriptor<CachedWechatConversation>(predicate: convPredicate)
        convDescriptor.fetchLimit = 1
        if let conversation = try modelContext.fetch(convDescriptor).first {
            conversation.updatedAt = Date()
        }
        
        try modelContext.save()
        logger.info("[WechatChatCache] Saved \(messages.count) messages to conversation: \(conversationId)")
    }
    
    // MARK: - Screenshot Metadata
    
    /// 保存截图元数据
    func saveScreenshotMeta(_ screenshot: WechatScreenshot, conversationId: String) throws {
        let meta = CachedWechatScreenshotMeta(from: screenshot, conversationId: conversationId)
        modelContext.insert(meta)
        try modelContext.save()
        logger.info("[WechatChatCache] Saved screenshot metadata: \(screenshot.id)")
    }
    
    // MARK: - Cleanup
    
    /// 清除所有数据
    func clearAllData() throws {
        // 删除所有消息
        let messageDescriptor = FetchDescriptor<CachedWechatMessage>()
        let messages = try modelContext.fetch(messageDescriptor)
        for message in messages {
            modelContext.delete(message)
        }
        
        // 删除所有截图元数据
        let metaDescriptor = FetchDescriptor<CachedWechatScreenshotMeta>()
        let metas = try modelContext.fetch(metaDescriptor)
        for meta in metas {
            modelContext.delete(meta)
        }
        
        // 删除所有对话
        let convDescriptor = FetchDescriptor<CachedWechatConversation>()
        let conversations = try modelContext.fetch(convDescriptor)
        for conv in conversations {
            modelContext.delete(conv)
        }
        
        try modelContext.save()
        logger.info("[WechatChatCache] Cleared all local data")
    }
}

