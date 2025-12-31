import Foundation

/// Chats 数据源适配器
/// 将微信聊天消息同步到 Notion
final class ChatsNotionAdapter: NotionSyncSourceProtocol {
    
    // MARK: - Dependencies
    
    private let cacheService: ChatCacheServiceProtocol
    
    // MARK: - State
    
    private let contact: ChatBookListItem
    
    // MARK: - Initialization
    
    init(
        contact: ChatBookListItem,
        cacheService: ChatCacheServiceProtocol = DIContainer.shared.chatsCacheService
    ) {
        self.contact = contact
        self.cacheService = cacheService
    }
    
    // MARK: - NotionSyncSourceProtocol
    
    var sourceKey: String { "chats" }
    
    var databaseTitle: String { "SyncNos-Chats" }
    
    var highlightSource: HighlightSource { .chats }
    
    var syncItem: UnifiedSyncItem {
        UnifiedSyncItem(from: contact)
    }
    
    var additionalPropertyDefinitions: [String: Any] {
        [
            "Contact": ["rich_text": [:]],
            "Message Count": ["number": ["format": "number"]]
        ]
    }
    
    var supportedStrategies: [NotionSyncStrategy] {
        [.singleDatabase]
    }
    
    var currentStrategy: NotionSyncStrategy {
        .singleDatabase
    }
    
    func fetchHighlights() async throws -> [UnifiedHighlight] {
        // 从本地缓存获取所有消息
        let messages = try await cacheService.fetchAllMessages(conversationId: contact.id)
        
        // 转换为 UnifiedHighlight
        return messages.map { UnifiedHighlight(from: $0, contactName: contact.name) }
    }
    
    func additionalPageProperties() -> [String: Any] {
        var properties: [String: Any] = [:]
        
        // Contact Name
        properties["Contact"] = ["rich_text": [["text": ["content": contact.name]]]]
        
        // Message Count
        properties["Message Count"] = ["number": contact.messageCount]
        
        return properties
    }
}

// MARK: - Factory

extension ChatsNotionAdapter {
    
    /// 创建适配器
    static func create(
        contact: ChatBookListItem,
        cacheService: ChatCacheServiceProtocol = DIContainer.shared.chatsCacheService
    ) -> ChatsNotionAdapter {
        ChatsNotionAdapter(contact: contact, cacheService: cacheService)
    }
}
