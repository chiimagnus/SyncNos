import Foundation
import AppKit

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
    var messages: [WechatMessage]
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

// MARK: - Wechat Conversation

/// 微信对话（多张截图合并）
struct WechatConversation {
    var screenshots: [WechatScreenshot]
    let createdAt: Date
    
    init(screenshots: [WechatScreenshot] = []) {
        self.screenshots = screenshots
        self.createdAt = Date()
    }
    
    /// 所有消息（按顺序）
    var allMessages: [WechatMessage] {
        screenshots.flatMap { $0.messages }
    }
    
    /// 导出为纯文本
    func exportAsText() -> String {
        var lines: [String] = []
        
        for message in allMessages {
            switch message.type {
            case .timestamp:
                lines.append("\n── \(message.content) ──\n")
            case .system:
                lines.append("[\(message.content)]")
            case .text, .image, .voice:
                let sender = message.isFromMe ? "我" : (message.senderName ?? "对方")
                lines.append("\(sender): \(message.content)")
            }
        }
        
        return lines.joined(separator: "\n")
    }
}

