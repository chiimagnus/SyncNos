import Foundation

/// Chats 数据源适配器
/// 将微信聊天消息同步到 Notion
final class ChatsNotionAdapter: NotionSyncSourceProtocol {

    // MARK: - Constants

    private static let groupUUIDPrefix = "chats-group:"
    
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

    // MARK: - NotionSyncSourceProtocol Hooks

    func pageHeaderTitleForNewPage() -> String? {
        // Chats 页面使用 `## @xxx` 分组标题，不需要默认的 "Highlights" 标题
        nil
    }

    func highlightsHeadingTitleForNewPageAppend() -> String? {
        // Chats 不使用通用“高亮列表”追加逻辑
        nil
    }

    func fetchHighlights() async throws -> [UnifiedHighlight] {
        // 从本地缓存获取所有消息
        let messages = try await cacheService.fetchAllMessages(conversationId: contact.id)
        
        // 转换为 UnifiedHighlight（增量同步：插入分组标题块 + 消息块）
        return buildIncrementalSyncHighlights(messages: messages)
    }
    
    func additionalPageProperties() -> [String: Any] {
        var properties: [String: Any] = [:]
        
        // Contact Name
        properties["Contact"] = ["rich_text": [["text": ["content": contact.name]]]]
        
        // Message Count
        properties["Message Count"] = ["number": contact.messageCount]
        
        return properties
    }
    
    func syncHighlightCount(for highlights: [UnifiedHighlight]) -> Int {
        highlights.filter { !$0.uuid.hasPrefix(Self.groupUUIDPrefix) }.count
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

// MARK: - Incremental Sync Highlights

private extension ChatsNotionAdapter {

    func buildIncrementalSyncHighlights(messages: [ChatMessage]) -> [UnifiedHighlight] {
        var results: [UnifiedHighlight] = []
        results.reserveCapacity(messages.count * 2)

        var lastSender: String? = nil
        var groupIndex = 0

        for message in messages.sorted(by: { $0.order < $1.order }) {
            let sender = formatSender(message)
            if sender != lastSender {
                groupIndex += 1
                let uuid = "\(Self.groupUUIDPrefix)\(contact.id):\(groupIndex)"
                results.append(UnifiedHighlight(
                    uuid: uuid,
                    text: "@\(sender)",
                    note: nil,
                    colorIndex: nil,
                    dateAdded: nil,
                    dateModified: nil,
                    location: nil,
                    source: .chats
                ))
                lastSender = sender
            }

            let (content, colorIndex) = formatMessageContentAndStyle(message)
            results.append(UnifiedHighlight(
                uuid: message.id.uuidString,
                text: content,
                note: nil,
                colorIndex: colorIndex,
                dateAdded: nil,
                dateModified: nil,
                location: nil,
                source: .chats
            ))
        }

        return results
    }

    func formatSender(_ message: ChatMessage) -> String {
        if message.kind == .system {
            return "System"
        }
        if message.isFromMe {
            return "Me"
        }
        if let senderName = message.senderName, !senderName.isEmpty {
            return senderName
        }
        return contact.name
    }

    func formatMessageContentAndStyle(_ message: ChatMessage) -> (content: String, colorIndex: Int?) {
        switch message.kind {
        case .system:
            return (message.content, 2)
        case .image:
            return ("📷 [Image]", message.isFromMe ? 0 : 1)
        case .voice:
            return ("🎤 [Voice]", message.isFromMe ? 0 : 1)
        case .card:
            let trimmed = message.content.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                return ("📋 [Card]", message.isFromMe ? 0 : 1)
            }
            return ("📋 [Card]\n\(trimmed)", message.isFromMe ? 0 : 1)
        case .text:
            return (message.content, message.isFromMe ? 0 : 1)
        }
    }
}
