import Foundation
import AppKit

// MARK: - OCR Request/Response Models

enum OCRMessageContent: Encodable {
    case text(String)
    case imageURL(url: String)
    
    private enum CodingKeys: String, CodingKey {
        case type, text
        case imageUrl = "image_url"
    }
    
    private enum ImageURLKeys: String, CodingKey { case url }
    
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

struct OCRRequestMessage: Encodable {
    let role: String
    let content: [OCRMessageContent]
}

struct OCRRequest: Encodable {
    let model: String
    let messages: [OCRRequestMessage]
    let maxTokens: Int
    let temperature: Double
    
    private enum CodingKeys: String, CodingKey {
        case model, messages
        case maxTokens = "max_tokens"
        case temperature
    }
}

struct OCRResponse: Decodable {
    let id: String?
    let choices: [OCRChoice]?
    let usage: OCRUsage?
    let error: OCRError?
}

struct OCRChoice: Decodable {
    let message: OCRResponseMessage?
}

struct OCRResponseMessage: Decodable {
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
}

// MARK: - OCR BBox Models

/// OCR 识别的文本块（带边界框）
struct OCRTextBlock: Identifiable {
    let id: UUID
    let text: String         // 识别的文字
    let bbox: CGRect         // 归一化坐标 (0-1)
    let rawBbox: [Int]       // 原始坐标 (0-999)
    
    init(id: UUID = UUID(), text: String, rawBbox: [Int]) {
        self.id = id
        self.text = text
        self.rawBbox = rawBbox
        
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
    
    /// 转换为像素坐标
    func pixelRect(imageSize: CGSize) -> CGRect {
        CGRect(
            x: bbox.origin.x * imageSize.width,
            y: bbox.origin.y * imageSize.height,
            width: bbox.width * imageSize.width,
            height: bbox.height * imageSize.height
        )
    }
}

/// 带 bbox 的 OCR 结果
struct OCRResultWithBBox {
    let rawText: String
    let textBlocks: [OCRTextBlock]
    let processedAt: Date
    let sourceImage: NSImage?
    let tokenUsage: OCRUsage?
}

// MARK: - OCR Service Error

enum OCRServiceError: LocalizedError {
    case apiKeyNotConfigured
    case invalidImageData
    case networkError(Error)
    case apiError(String)
    case rateLimitExceeded
    case unknown(String)
    
    var errorDescription: String? {
        switch self {
        case .apiKeyNotConfigured: return "OCR API Key 未配置"
        case .invalidImageData: return "无效的图片数据"
        case .networkError(let error): return "网络错误: \(error.localizedDescription)"
        case .apiError(let message): return "API 错误: \(message)"
        case .rateLimitExceeded: return "API 请求频率超限"
        case .unknown(let message): return "未知错误: \(message)"
        }
    }
}
