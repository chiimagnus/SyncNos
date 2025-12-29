import Foundation
import AppKit

// MARK: - OCR Result (统一结果模型)

/// OCR 识别结果
struct OCRResult {
    let rawText: String
    let markdownText: String?
    let blocks: [OCRBlock]
    let processedAt: Date
    /// OCR 输出坐标系对应的图像尺寸（单位：px）
    /// - 若为空，调用方可回退到 `cgImage.width/height`
    let coordinateSize: CGSize?
}

/// OCR 识别的文本块
struct OCRBlock: Identifiable {
    let id = UUID()
    let text: String
    let label: String  // "text" 等
    let bbox: CGRect   // 像素坐标（原点左上角）
}

// MARK: - OCR Request Config

/// OCR 请求参数配置（Vision 框架不需要这些参数，保留以兼容接口）
struct OCRRequestConfig: Sendable {
    static let `default` = OCRRequestConfig()
}

// MARK: - OCR Service Protocol

/// OCR 服务协议
protocol OCRAPIServiceProtocol {
    /// 识别图片
    func recognize(_ image: NSImage) async throws -> OCRResult
    
    /// 识别图片（返回 raw JSON，便于持久化/回放/排障）
    func recognizeWithRaw(_ image: NSImage, config: OCRRequestConfig) async throws -> (result: OCRResult, rawResponse: Data, requestJSON: Data)
    
    /// 测试 API 连接（Vision 始终返回 true）
    func testConnection() async throws -> Bool
}

// MARK: - OCR Service Error

enum OCRServiceError: LocalizedError {
    case invalidImage
    case invalidResponse
    case noResult
    
    var errorDescription: String? {
        switch self {
        case .invalidImage: return "无效的图片数据"
        case .invalidResponse: return "无效的响应"
        case .noResult: return "OCR 返回空结果"
        }
    }
}
