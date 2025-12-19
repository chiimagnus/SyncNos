import Foundation
import AppKit

// MARK: - OCR Request/Response Models

/// OCR API 请求消息内容类型
enum OCRMessageContent: Encodable {
    case text(String)
    case imageURL(url: String)
    
    private enum CodingKeys: String, CodingKey {
        case type
        case text
        case imageUrl = "image_url"
    }
    
    private enum ImageURLKeys: String, CodingKey {
        case url
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .text(let text):
            try container.encode("text", forKey: .type)
            try container.encode(text, forKey: .text)
        case .imageURL(let url):
            try container.encode("image_url", forKey: .type)
            var imageContainer = container.nestedContainer(keyedBy: ImageURLKeys.self, forKey: .imageUrl)
            try imageContainer.encode(url, forKey: .url)
        }
    }
}

/// OCR API 请求消息
struct OCRRequestMessage: Encodable {
    let role: String
    let content: [OCRMessageContent]
}

/// OCR API 请求体
struct OCRRequest: Encodable {
    let model: String
    let messages: [OCRRequestMessage]
    let maxTokens: Int
    let temperature: Double
    
    private enum CodingKeys: String, CodingKey {
        case model
        case messages
        case maxTokens = "max_tokens"
        case temperature
    }
}

/// OCR API 响应
struct OCRResponse: Decodable {
    let id: String?
    let object: String?
    let created: Int?
    let model: String?
    let choices: [OCRChoice]?
    let usage: OCRUsage?
    let error: OCRError?
}

struct OCRChoice: Decodable {
    let index: Int?
    let message: OCRResponseMessage?
    let finishReason: String?
    
    private enum CodingKeys: String, CodingKey {
        case index
        case message
        case finishReason = "finish_reason"
    }
}

struct OCRResponseMessage: Decodable {
    let role: String?
    let content: String?
}

struct OCRUsage: Decodable {
    let promptTokens: Int?
    let completionTokens: Int?
    let totalTokens: Int?
    
    private enum CodingKeys: String, CodingKey {
        case promptTokens = "prompt_tokens"
        case completionTokens = "completion_tokens"
        case totalTokens = "total_tokens"
    }
}

struct OCRError: Decodable {
    let message: String?
    let type: String?
    let code: String?
}

// MARK: - Wechat Chat Message Model

/// 微信聊天消息
struct WechatChatMessage: Identifiable, Codable {
    let id: UUID
    let sender: String           // 发送者名称
    let content: String          // 消息内容
    let timestamp: Date?         // 时间戳
    let isFromMe: Bool           // 是否是自己发送的
    let messageType: MessageType // 消息类型
    
    enum MessageType: String, Codable {
        case text = "text"
        case image = "image"
        case voice = "voice"
        case video = "video"
        case link = "link"
        case emoji = "emoji"
        case file = "file"
        case unknown = "unknown"
    }
    
    init(id: UUID = UUID(), sender: String, content: String, timestamp: Date? = nil, isFromMe: Bool = false, messageType: MessageType = .text) {
        self.id = id
        self.sender = sender
        self.content = content
        self.timestamp = timestamp
        self.isFromMe = isFromMe
        self.messageType = messageType
    }
}

/// 微信聊天截图识别结果
struct WechatOCRResult {
    let rawText: String              // 原始 OCR 结果
    let messages: [WechatChatMessage] // 解析后的消息列表
    let processedAt: Date            // 处理时间
    let sourceImage: NSImage?        // 原始图片
    let tokenUsage: OCRUsage?        // Token 使用量
}

// MARK: - OCR BBox Models

/// OCR 识别的文本块（带边界框）
struct OCRTextBlock: Identifiable {
    let id: UUID
    let text: String                 // 识别的文字
    let bbox: CGRect                 // 边界框（归一化坐标 0-1）
    let rawBbox: [Int]               // 原始坐标 (0-999)
    let blockType: BlockType         // 块类型
    
    enum BlockType: String {
        case text = "text"
        case title = "title"
        case image = "image"
        case table = "table"
        case formula = "formula"
        case unknown = "unknown"
    }
    
    init(id: UUID = UUID(), text: String, rawBbox: [Int], blockType: BlockType = .text) {
        self.id = id
        self.text = text
        self.rawBbox = rawBbox
        self.blockType = blockType
        
        // 将 0-999 坐标转换为 0-1 归一化坐标
        if rawBbox.count >= 4 {
            let x1 = CGFloat(rawBbox[0]) / 999.0
            let y1 = CGFloat(rawBbox[1]) / 999.0
            let x2 = CGFloat(rawBbox[2]) / 999.0
            let y2 = CGFloat(rawBbox[3]) / 999.0
            self.bbox = CGRect(x: x1, y: y1, width: x2 - x1, height: y2 - y1)
        } else {
            self.bbox = .zero
        }
    }
    
    /// 将归一化坐标转换为实际像素坐标
    func pixelRect(imageSize: CGSize) -> CGRect {
        return CGRect(
            x: bbox.origin.x * imageSize.width,
            y: bbox.origin.y * imageSize.height,
            width: bbox.width * imageSize.width,
            height: bbox.height * imageSize.height
        )
    }
}

/// 带 bbox 的 OCR 识别结果
struct OCRResultWithBBox {
    let rawText: String              // 原始 OCR 结果
    let textBlocks: [OCRTextBlock]   // 文本块列表（带 bbox）
    let processedAt: Date            // 处理时间
    let sourceImage: NSImage?        // 原始图片
    let tokenUsage: OCRUsage?        // Token 使用量
}

// MARK: - OCR Service Error

/// OCR 服务错误
enum OCRServiceError: LocalizedError {
    case apiKeyNotConfigured
    case invalidImageData
    case networkError(Error)
    case apiError(String)
    case decodingError(Error)
    case rateLimitExceeded
    case unknown(String)
    
    var errorDescription: String? {
        switch self {
        case .apiKeyNotConfigured:
            return "OCR API Key 未配置，请在设置中配置硅基流动 API Key"
        case .invalidImageData:
            return "无效的图片数据"
        case .networkError(let error):
            return "网络错误: \(error.localizedDescription)"
        case .apiError(let message):
            return "API 错误: \(message)"
        case .decodingError(let error):
            return "数据解析错误: \(error.localizedDescription)"
        case .rateLimitExceeded:
            return "API 请求频率超限，请稍后重试"
        case .unknown(let message):
            return "未知错误: \(message)"
        }
    }
}
