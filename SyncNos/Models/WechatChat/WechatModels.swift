import Foundation
import AppKit

// MARK: - Wechat Contact (联系人/对话)

/// 微信联系人/对话（由用户创建或从截图标题提取）
struct WechatContact: Identifiable, Hashable {
    let id: UUID
    let name: String
    let avatarColor: NSColor

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
        self.avatarColor = WechatContact.randomAvatarColor()
        self.lastMessage = lastMessage
        self.lastMessageTime = lastMessageTime
        self.messageCount = messageCount
    }

    private static func randomAvatarColor() -> NSColor {
        let colors: [NSColor] = [
            .systemBlue, .systemGreen, .systemOrange,
            .systemPink, .systemPurple, .systemRed, .systemTeal
        ]
        return colors.randomElement() ?? .systemBlue
    }
}

// MARK: - Wechat Message (V2)

/// 消息类型（仅气泡消息；不包含 timestamp/system）
enum WechatMessageKind: String, Hashable, Sendable {
    case text
    case image
    case voice
    case card
}

/// 微信聊天消息（V2：仅气泡消息）
struct WechatMessage: Identifiable, Hashable {
    let id: UUID
    let content: String
    let isFromMe: Bool
    let senderName: String?
    let kind: WechatMessageKind
    let bbox: CGRect?
    let order: Int

    init(
        id: UUID = UUID(),
        content: String,
        isFromMe: Bool,
        senderName: String? = nil,
        kind: WechatMessageKind = .text,
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

// MARK: - Wechat Screenshot (Import Session)

/// 导入的微信聊天截图（内存态，用于导入/处理中间态；不持久化图片本体）
struct WechatScreenshot: Identifiable {
    let id: UUID
    let image: NSImage
    let imageSize: CGSize
    let importedAt: Date

    /// 解析结果
    var messages: [WechatMessage]

    /// 处理状态
    var isProcessing: Bool
    var error: String?

    init(
        id: UUID = UUID(),
        image: NSImage,
        messages: [WechatMessage] = [],
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

// MARK: - Wechat Conversation (V2)

/// 微信对话（一个联系人的消息集合；不再把截图作为 UI 结构的一部分）
struct WechatConversation: Identifiable {
    let id: UUID
    var contact: WechatContact
    var messages: [WechatMessage]

    init(contact: WechatContact, messages: [WechatMessage] = []) {
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

// MARK: - Wechat Book List Item (for MainListView compatibility)

/// 微信联系人列表项（用于 MainListView 兼容）
struct WechatBookListItem: Identifiable {
    let id: String              // contactId.uuidString
    let contactId: UUID
    let name: String
    let lastMessage: String?
    let lastMessageTime: String?
    let messageCount: Int
    let avatarColor: NSColor

    init(from contact: WechatContact) {
        self.id = contact.id.uuidString
        self.contactId = contact.id
        self.name = contact.name
        self.lastMessage = contact.lastMessage
        self.lastMessageTime = contact.lastMessageTime
        self.messageCount = contact.messageCount
        self.avatarColor = contact.avatarColor
    }
}

// MARK: - WechatChat Parse Config

/// 微信聊天截图解析参数（集中管理，避免阈值散落在 Parser 内部）
struct WechatChatParseConfig: Sendable {
    // MARK: Line Grouping
    var maxLineHorizontalGapPx: Double
    var minLineVerticalOverlapRatio: Double

    // MARK: Message Grouping
    var maxMessageLineGapPx: Double
    var maxMessageXAlignDeltaPx: Double

    static let `default` = WechatChatParseConfig(
        maxLineHorizontalGapPx: 18,
        minLineVerticalOverlapRatio: 0.30,
        maxMessageLineGapPx: 26,
        maxMessageXAlignDeltaPx: 28
    )
}


