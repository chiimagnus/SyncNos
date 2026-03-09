import Foundation
import AppKit

// MARK: - Chat Contact

/// Chat contact/conversation (created by user or extracted from screenshot title)
struct ChatContact: Identifiable, Hashable {
    let id: UUID
    let name: String

    // UI 预览字段（可为空）
    var lastMessage: String?
    var lastMessageTime: String?  // V2 暂不展示时间，保留字段以便未来扩展
    var messageCount: Int

    init(
        id: UUID = UUID(),
        name: String,
        lastMessage: String? = nil,
        lastMessageTime: String? = nil,
        messageCount: Int = 0
    ) {
        self.id = id
        self.name = name
        self.lastMessage = lastMessage
        self.lastMessageTime = lastMessageTime
        self.messageCount = messageCount
    }

}

// MARK: - Chat Message (V2)

/// 消息类型（仅气泡消息；不包含 timestamp/system）
enum ChatMessageKind: String, Hashable, Sendable {
    case text
    case image
    case voice
    case card
    /// 居中显示的系统/时间戳类文本（不做关键词识别，仅用几何规则判定）
    case system
}

/// Chat message (V2: bubble messages only)
struct ChatMessage: Identifiable, Hashable {
    let id: UUID
    let content: String
    let isFromMe: Bool
    let senderName: String?
    let kind: ChatMessageKind
    let bbox: CGRect?
    let order: Int

    init(
        id: UUID = UUID(),
        content: String,
        isFromMe: Bool,
        senderName: String? = nil,
        kind: ChatMessageKind = .text,
        bbox: CGRect? = nil,
        order: Int = 0
    ) {
        self.id = id
        self.content = content
        self.isFromMe = isFromMe
        self.senderName = senderName
        self.kind = kind
        self.bbox = bbox
        self.order = order
    }
}

// MARK: - Chat Screenshot (Import Session)

/// Imported chat screenshot (in-memory state for import/processing; image body not persisted)
struct ChatScreenshot: Identifiable {
    let id: UUID
    let image: NSImage
    let imageSize: CGSize
    let importedAt: Date

    /// 解析结果
    var messages: [ChatMessage]

    /// 处理状态
    var isProcessing: Bool
    var error: String?

    init(
        id: UUID = UUID(),
        image: NSImage,
        messages: [ChatMessage] = [],
        isProcessing: Bool = false,
        error: String? = nil
    ) {
        self.id = id
        self.image = image
        self.imageSize = image.size
        self.importedAt = Date()
        self.messages = messages
        self.isProcessing = isProcessing
        self.error = error
    }
}

// MARK: - Chat Conversation (V2)

/// Chat conversation (a collection of messages for a contact; screenshots no longer part of UI structure)
struct ChatConversation: Identifiable {
    let id: UUID
    var contact: ChatContact
    var messages: [ChatMessage]

    init(contact: ChatContact, messages: [ChatMessage] = []) {
        self.id = contact.id
        self.contact = contact
        self.messages = messages
    }

    /// 导出为纯文本
    func exportAsText() -> String {
        var lines: [String] = []
        lines.append("=== \(contact.name) ===\n")

        for message in messages.sorted(by: { $0.order < $1.order }) {
            let sender = message.isFromMe ? "我" : (message.senderName ?? contact.name)
            switch message.kind {
            case .system:
                lines.append("[系统] \(message.content)")
            case .image:
                lines.append("\(sender): [图片]")
            case .voice:
                lines.append("\(sender): [语音]")
            case .card:
                lines.append("\(sender): [卡片]\n\(message.content)")
            case .text:
                lines.append("\(sender): \(message.content)")
            }
        }

        return lines.joined(separator: "\n")
    }
}

// MARK: - Chat Book List Item (for MainListView compatibility)

/// Chat contact list item (for MainListView compatibility)
struct ChatBookListItem: Identifiable {
    let id: String              // contactId.uuidString
    let contactId: UUID
    let name: String
    let lastMessage: String?
    let lastMessageTime: String?
    let messageCount: Int

    init(from contact: ChatContact) {
        self.id = contact.id.uuidString
        self.contactId = contact.id
        self.name = contact.name
        self.lastMessage = contact.lastMessage
        self.lastMessageTime = contact.lastMessageTime
        self.messageCount = contact.messageCount
    }
}

// MARK: - Chat Parse Config

/// Chat screenshot parsing parameters (centralized management, avoiding thresholds scattered in Parser)
struct ChatParseConfig: Sendable {
    // MARK: Line Grouping
    var maxLineHorizontalGapPx: Double
    var minLineVerticalOverlapRatio: Double

    // MARK: Message Grouping
    var maxMessageLineGapPx: Double
    var maxMessageXAlignDeltaPx: Double

    static let `default` = ChatParseConfig(
        maxLineHorizontalGapPx: 18,
        minLineVerticalOverlapRatio: 0.30,
        maxMessageLineGapPx: 26,
        maxMessageXAlignDeltaPx: 28
    )
}


