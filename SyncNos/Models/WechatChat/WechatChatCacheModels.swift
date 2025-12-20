import Foundation
import SwiftData

// MARK: - Cached Wechat Conversation

/// 缓存的微信对话
@Model
final class CachedWechatConversation {
    /// 对话唯一标识
    @Attribute(.unique) var conversationId: String
    
    /// 联系人名称
    var name: String
    
    /// 创建时间
    var createdAt: Date
    
    /// 最后更新时间
    var updatedAt: Date
    
    // MARK: - 关系
    
    /// 关联的消息列表
    @Relationship(deleteRule: .cascade, inverse: \CachedWechatMessage.conversation)
    var messages: [CachedWechatMessage]?
    
    /// 关联的截图元数据
    @Relationship(deleteRule: .cascade, inverse: \CachedWechatScreenshotMeta.conversation)
    var screenshotMetas: [CachedWechatScreenshotMeta]?
    
    // MARK: - 初始化
    
    init(
        conversationId: String,
        name: String,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.conversationId = conversationId
        self.name = name
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
    
    /// 从内存模型创建
    convenience init(from contact: WechatContact) {
        self.init(
            conversationId: contact.id.uuidString,
            name: contact.name,
            createdAt: Date(),
            updatedAt: Date()
        )
    }
}

// MARK: - Cached Wechat Message

/// 缓存的微信消息
@Model
final class CachedWechatMessage {
    /// 消息唯一标识
    @Attribute(.unique) var messageId: String
    
    /// 所属对话 ID
    var conversationId: String
    
    /// 所属截图 ID
    var screenshotId: String
    
    /// 消息内容
    var content: String
    
    /// 是否是自己发送的
    var isFromMe: Bool
    
    /// 发送者昵称（群聊）
    var senderName: String?
    
    /// 消息类型
    var typeRaw: String
    
    /// 消息在截图中的顺序
    var blockOrder: Int
    
    /// bbox 坐标（JSON 编码）
    var bboxJSON: String?
    
    // MARK: - 关系
    
    /// 所属对话
    var conversation: CachedWechatConversation?
    
    // MARK: - 计算属性
    
    var messageType: WechatMessage.MessageType {
        WechatMessage.MessageType(rawValue: typeRaw) ?? .text
    }
    
    var bbox: CGRect {
        get {
            guard let json = bboxJSON,
                  let data = json.data(using: .utf8),
                  let dict = try? JSONDecoder().decode([String: CGFloat].self, from: data) else {
                return .zero
            }
            return CGRect(
                x: dict["x"] ?? 0,
                y: dict["y"] ?? 0,
                width: dict["width"] ?? 0,
                height: dict["height"] ?? 0
            )
        }
        set {
            let dict: [String: CGFloat] = [
                "x": newValue.origin.x,
                "y": newValue.origin.y,
                "width": newValue.size.width,
                "height": newValue.size.height
            ]
            if let data = try? JSONEncoder().encode(dict),
               let json = String(data: data, encoding: .utf8) {
                bboxJSON = json
            }
        }
    }
    
    // MARK: - 初始化
    
    init(
        messageId: String,
        conversationId: String,
        screenshotId: String,
        content: String,
        isFromMe: Bool,
        senderName: String? = nil,
        type: WechatMessage.MessageType = .text,
        blockOrder: Int = 0,
        bbox: CGRect = .zero
    ) {
        self.messageId = messageId
        self.conversationId = conversationId
        self.screenshotId = screenshotId
        self.content = content
        self.isFromMe = isFromMe
        self.senderName = senderName
        self.typeRaw = type.rawValue
        self.blockOrder = blockOrder
        
        // 设置 bbox
        let dict: [String: CGFloat] = [
            "x": bbox.origin.x,
            "y": bbox.origin.y,
            "width": bbox.size.width,
            "height": bbox.size.height
        ]
        if let data = try? JSONEncoder().encode(dict),
           let json = String(data: data, encoding: .utf8) {
            self.bboxJSON = json
        }
    }
    
    /// 从内存模型创建
    convenience init(from message: WechatMessage, conversationId: String, screenshotId: String) {
        self.init(
            messageId: message.id.uuidString,
            conversationId: conversationId,
            screenshotId: screenshotId,
            content: message.content,
            isFromMe: message.isFromMe,
            senderName: message.senderName,
            type: message.type,
            blockOrder: message.blockOrder,
            bbox: message.bbox
        )
    }
    
    /// 转换为内存模型
    func toWechatMessage() -> WechatMessage {
        WechatMessage(
            id: UUID(uuidString: messageId) ?? UUID(),
            content: content,
            isFromMe: isFromMe,
            senderName: senderName,
            type: messageType,
            bbox: bbox,
            blockOrder: blockOrder
        )
    }
}

// MARK: - Cached Wechat Screenshot Metadata

/// 缓存的微信截图元数据（不存储实际图片）
@Model
final class CachedWechatScreenshotMeta {
    /// 截图唯一标识
    @Attribute(.unique) var screenshotId: String
    
    /// 所属对话 ID
    var conversationId: String
    
    /// 导入时间
    var importedAt: Date
    
    /// 图片尺寸（宽度）
    var imageWidth: Double
    
    /// 图片尺寸（高度）
    var imageHeight: Double
    
    /// 从截图提取的联系人名称
    var extractedContactName: String?
    
    // MARK: - 关系
    
    /// 所属对话
    var conversation: CachedWechatConversation?
    
    // MARK: - 计算属性
    
    var imageSize: CGSize {
        CGSize(width: imageWidth, height: imageHeight)
    }
    
    // MARK: - 初始化
    
    init(
        screenshotId: String,
        conversationId: String,
        importedAt: Date = Date(),
        imageWidth: Double = 0,
        imageHeight: Double = 0,
        extractedContactName: String? = nil
    ) {
        self.screenshotId = screenshotId
        self.conversationId = conversationId
        self.importedAt = importedAt
        self.imageWidth = imageWidth
        self.imageHeight = imageHeight
        self.extractedContactName = extractedContactName
    }
    
    /// 从内存模型创建
    convenience init(from screenshot: WechatScreenshot, conversationId: String) {
        self.init(
            screenshotId: screenshot.id.uuidString,
            conversationId: conversationId,
            importedAt: screenshot.importedAt,
            imageWidth: screenshot.imageSize.width,
            imageHeight: screenshot.imageSize.height,
            extractedContactName: screenshot.contactName
        )
    }
}

// MARK: - Conversion Extensions

extension WechatContact {
    /// 从缓存模型创建内存模型
    init(from cached: CachedWechatConversation) {
        self.init(
            id: UUID(uuidString: cached.conversationId) ?? UUID(),
            name: cached.name,
            messageCount: cached.messages?.count ?? 0
        )
    }
}

extension WechatBookListItem {
    /// 从缓存模型创建 UI 列表模型
    init(from cached: CachedWechatConversation) {
        let contactId = UUID(uuidString: cached.conversationId) ?? UUID()
        let messages = cached.messages ?? []
        let textMessages = messages.filter { 
            let type = WechatMessage.MessageType(rawValue: $0.typeRaw) ?? .text
            return type == .text || type == .image || type == .voice
        }
        let lastTextMessage = textMessages.last
        let lastTimestamp = messages.last(where: { 
            let type = WechatMessage.MessageType(rawValue: $0.typeRaw) ?? .text
            return type == .timestamp
        })
        
        self.init(from: WechatContact(
            id: contactId,
            name: cached.name,
            lastMessage: lastTextMessage?.content,
            lastMessageTime: lastTimestamp?.content,
            messageCount: textMessages.count
        ))
    }
}

