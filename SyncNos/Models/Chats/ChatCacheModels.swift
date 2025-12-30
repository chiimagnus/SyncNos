import Foundation
import SwiftData

// MARK: - ChatChat SwiftData Models (V2 with Encryption)
//
// 说明：
// - 该 schema 对应 chats_v2.store 文件
// - 敏感字段（消息内容、发送者昵称、对话名称）使用 AES-256-GCM 加密存储
// - 加密密钥存储在 macOS Keychain，由 EncryptionService 管理
//
// 安全说明（Kerckhoffs 原则）：
// - 算法公开不影响安全性，安全性完全依赖密钥的保密性
// - 密钥由系统 Keychain 保护，受 macOS 登录密码保护
//

// MARK: - CachedChatConversationV2

@Model
final class CachedChatConversationV2 {
    /// 对话唯一标识（UUID 字符串）
    @Attribute(.unique) var conversationId: String

    /// 对话名称（加密存储）
    /// - 存储格式：AES-256-GCM combined (nonce + ciphertext + tag)
    var nameEncrypted: Data

    /// 创建时间
    var createdAt: Date

    /// 最后更新时间
    var updatedAt: Date

    // MARK: Relationships

    /// 该对话的截图记录
    @Relationship(deleteRule: .cascade, inverse: \CachedChatScreenshotV2.conversation)
    var screenshots: [CachedChatScreenshotV2]?

    /// 该对话的解析消息
    @Relationship(deleteRule: .cascade, inverse: \CachedChatMessageV2.conversation)
    var messages: [CachedChatMessageV2]?
    
    // MARK: Computed (解密访问器)
    
    /// 对话名称（解密后）
    var name: String {
        (try? EncryptionService.shared.decrypt(nameEncrypted)) ?? "[解密失败]"
    }

    /// 使用明文初始化（自动加密）
    /// - Throws: 加密失败时抛出错误
    convenience init(
        conversationId: String,
        name: String,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) throws {
        let encryptedName = try EncryptionService.shared.encrypt(name)
        self.init(
            conversationId: conversationId,
            nameEncrypted: encryptedName,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
    
    /// 使用已加密数据初始化
    init(
        conversationId: String,
        nameEncrypted: Data,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.conversationId = conversationId
        self.nameEncrypted = nameEncrypted
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
    
    /// 更新对话名称（加密后存储）
    func updateName(_ newName: String) throws {
        self.nameEncrypted = try EncryptionService.shared.encrypt(newName)
        self.updatedAt = Date()
    }
}

// MARK: - CachedChatScreenshotV2

/// 每张导入截图一条记录（不保存图片本体）
/// 
/// **V3 变更（2025-12-30）**：
/// - 删除 `ocrRequestJSON`、`ocrResponseJSON`、`normalizedBlocksJSON` 字段
/// - 这些字段包含明文消息内容，与加密策略冲突
/// - 离线重解析功能已放弃，不再需要保存 OCR 原始数据
@Model
final class CachedChatScreenshotV2 {
    /// 截图唯一标识（UUID 字符串）
    @Attribute(.unique) var screenshotId: String

    /// 所属对话 ID
    var conversationId: String

    /// 导入时间
    var importedAt: Date

    /// 图片尺寸（像素）
    var imageWidth: Double
    var imageHeight: Double

    /// OCR 引擎标识（便于后续扩展）
    var ocrEngine: String

    /// 本地解析完成时间
    var parsedAt: Date

    // MARK: Relationships

    var conversation: CachedChatConversationV2?

    init(
        screenshotId: String,
        conversationId: String,
        importedAt: Date,
        imageWidth: Double,
        imageHeight: Double,
        ocrEngine: String,
        parsedAt: Date
    ) {
        self.screenshotId = screenshotId
        self.conversationId = conversationId
        self.importedAt = importedAt
        self.imageWidth = imageWidth
        self.imageHeight = imageHeight
        self.ocrEngine = ocrEngine
        self.parsedAt = parsedAt
    }
}

// MARK: - CachedChatMessageV2

@Model
final class CachedChatMessageV2 {
    /// 消息唯一标识（UUID 字符串）
    @Attribute(.unique) var messageId: String

    /// 所属对话 ID
    var conversationId: String

    /// 所属截图 ID
    var screenshotId: String

    /// 消息内容（加密存储）
    /// - 存储格式：AES-256-GCM combined (nonce + ciphertext + tag)
    var contentEncrypted: Data

    /// 是否为我发送
    var isFromMe: Bool

    /// 群聊：发送者昵称（加密存储，可选）
    var senderNameEncrypted: Data?

    /// 消息类型（仅气泡消息；不包含 timestamp/system）
    var kindRaw: String

    /// 在该对话中的全局顺序（用于展示排序）
    var order: Int

    /// bbox（JSON 字符串，可选：用于 debug overlay）
    var bboxJSON: String?

    // MARK: Relationships

    var conversation: CachedChatConversationV2?

    // MARK: Computed (解密访问器)

    /// 消息内容（解密后）
    var content: String {
        (try? EncryptionService.shared.decrypt(contentEncrypted)) ?? "[解密失败]"
    }
    
    /// 发送者昵称（解密后）
    var senderName: String? {
        guard let encrypted = senderNameEncrypted else { return nil }
        return try? EncryptionService.shared.decrypt(encrypted)
    }

    var kind: ChatMessageKind {
        ChatMessageKind(rawValue: kindRaw) ?? .text
    }

    var bbox: CGRect? {
        get {
            guard let json = bboxJSON,
                  let data = json.data(using: .utf8),
                  let dict = try? JSONDecoder().decode([String: CGFloat].self, from: data) else {
                return nil
            }
            return CGRect(
                x: dict["x"] ?? 0,
                y: dict["y"] ?? 0,
                width: dict["width"] ?? 0,
                height: dict["height"] ?? 0
            )
        }
        set {
            guard let newValue else {
                bboxJSON = nil
                return
            }
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

    /// 使用明文初始化（自动加密）
    /// - Throws: 加密失败时抛出错误
    convenience init(
        messageId: String,
        conversationId: String,
        screenshotId: String,
        content: String,
        isFromMe: Bool,
        senderName: String? = nil,
        kind: ChatMessageKind = .text,
        order: Int,
        bbox: CGRect? = nil
    ) throws {
        let encryptedContent = try EncryptionService.shared.encrypt(content)
        let encryptedSenderName = try senderName.map { try EncryptionService.shared.encrypt($0) }
        
        self.init(
            messageId: messageId,
            conversationId: conversationId,
            screenshotId: screenshotId,
            contentEncrypted: encryptedContent,
            isFromMe: isFromMe,
            senderNameEncrypted: encryptedSenderName,
            kind: kind,
            order: order,
            bbox: bbox
        )
    }
    
    /// 使用已加密数据初始化
    init(
        messageId: String,
        conversationId: String,
        screenshotId: String,
        contentEncrypted: Data,
        isFromMe: Bool,
        senderNameEncrypted: Data?,
        kind: ChatMessageKind = .text,
        order: Int,
        bbox: CGRect? = nil
    ) {
        self.messageId = messageId
        self.conversationId = conversationId
        self.screenshotId = screenshotId
        self.contentEncrypted = contentEncrypted
        self.isFromMe = isFromMe
        self.senderNameEncrypted = senderNameEncrypted
        self.kindRaw = kind.rawValue
        self.order = order

        if let bbox {
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
    }
    
    /// 更新发送者昵称（加密后存储）
    func updateSenderName(_ newName: String?) throws {
        if let name = newName, !name.isEmpty {
            self.senderNameEncrypted = try EncryptionService.shared.encrypt(name)
        } else {
            self.senderNameEncrypted = nil
        }
    }
    
    /// 更新消息内容（加密后存储）
    func updateContent(_ newContent: String) throws {
        self.contentEncrypted = try EncryptionService.shared.encrypt(newContent)
    }
}

// MARK: - Deprecated: Normalized Block Snapshot
//
// ChatOCRBlockSnapshot 和 ChatRectSnapshot 已移除（2025-12-30）
// - 离线重解析功能已放弃
// - OCR 原始数据不再持久化
// - 这些类型与加密策略冲突


