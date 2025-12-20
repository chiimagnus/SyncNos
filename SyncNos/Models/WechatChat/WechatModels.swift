import Foundation
import AppKit

// MARK: - Wechat Contact (联系人/对话)

/// 微信联系人/对话（从截图标题或消息中提取）
struct WechatContact: Identifiable, Hashable {
    let id: UUID
    let name: String                    // 联系人/群聊名称
    let avatarColor: NSColor            // 随机头像颜色
    var lastMessage: String?            // 最后一条消息预览
    var lastMessageTime: String?        // 最后消息时间
    var messageCount: Int               // 消息数量
    var isGroup: Bool                   // 是否是群聊
    
    init(
        id: UUID = UUID(),
        name: String,
        lastMessage: String? = nil,
        lastMessageTime: String? = nil,
        messageCount: Int = 0,
        isGroup: Bool = false
    ) {
        self.id = id
        self.name = name
        self.avatarColor = WechatContact.randomAvatarColor()
        self.lastMessage = lastMessage
        self.lastMessageTime = lastMessageTime
        self.messageCount = messageCount
        self.isGroup = isGroup
    }
    
    private static func randomAvatarColor() -> NSColor {
        let colors: [NSColor] = [
            .systemBlue, .systemGreen, .systemOrange,
            .systemPink, .systemPurple, .systemRed, .systemTeal
        ]
        return colors.randomElement() ?? .systemBlue
    }
}

// MARK: - Wechat Message

/// 微信聊天消息
struct WechatMessage: Identifiable, Hashable {
    let id: UUID
    let content: String
    let isFromMe: Bool
    let senderName: String?
    let type: MessageType
    let bbox: CGRect
    let blockOrder: Int
    
    enum MessageType: String, Hashable {
        case text       // 普通文本
        case timestamp  // 时间戳
        case system     // 系统消息
        case image      // 图片
        case voice      // 语音
    }
    
    init(
        id: UUID = UUID(),
        content: String,
        isFromMe: Bool,
        senderName: String? = nil,
        type: MessageType = .text,
        bbox: CGRect = .zero,
        blockOrder: Int = 0
    ) {
        self.id = id
        self.content = content
        self.isFromMe = isFromMe
        self.senderName = senderName
        self.type = type
        self.bbox = bbox
        self.blockOrder = blockOrder
    }
}

// MARK: - Wechat Screenshot

/// 微信聊天截图
struct WechatScreenshot: Identifiable {
    let id: UUID
    let image: NSImage
    let imageSize: CGSize
    let importedAt: Date
    var contactName: String?            // 从截图标题提取的联系人名称
    var messages: [WechatMessage]
    var isProcessing: Bool
    var error: String?
    
    init(
        id: UUID = UUID(),
        image: NSImage,
        contactName: String? = nil,
        messages: [WechatMessage] = [],
        isProcessing: Bool = false,
        error: String? = nil
    ) {
        self.id = id
        self.image = image
        self.imageSize = image.size
        self.importedAt = Date()
        self.contactName = contactName
        self.messages = messages
        self.isProcessing = isProcessing
        self.error = error
    }
}

// MARK: - Wechat Conversation

/// 微信对话（一个联系人的所有消息）
struct WechatConversation: Identifiable {
    let id: UUID
    let contact: WechatContact
    var screenshots: [WechatScreenshot]
    
    init(contact: WechatContact, screenshots: [WechatScreenshot] = []) {
        self.id = contact.id
        self.contact = contact
        self.screenshots = screenshots
    }
    
    /// 所有消息（按顺序）
    var allMessages: [WechatMessage] {
        screenshots.flatMap { $0.messages }
    }
    
    /// 导出为纯文本
    func exportAsText() -> String {
        var lines: [String] = []
        lines.append("=== \(contact.name) ===\n")
        
        for message in allMessages {
            switch message.type {
            case .timestamp:
                lines.append("\n── \(message.content) ──\n")
            case .system:
                lines.append("[\(message.content)]")
            case .text, .image, .voice:
                let sender = message.isFromMe ? "我" : (message.senderName ?? contact.name)
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
    let isGroup: Bool
    let avatarColor: NSColor
    
    init(from contact: WechatContact) {
        self.id = contact.id.uuidString
        self.contactId = contact.id
        self.name = contact.name
        self.lastMessage = contact.lastMessage
        self.lastMessageTime = contact.lastMessageTime
        self.messageCount = contact.messageCount
        self.isGroup = contact.isGroup
        self.avatarColor = contact.avatarColor
    }
}
