import Foundation
import AppKit

// MARK: - PaddleOCR Request

struct PaddleOCRRequest: Encodable {
    let file: String
    let fileType: Int
    let useDocOrientationClassify: Bool
    let useDocUnwarping: Bool
    let useLayoutDetection: Bool
    let useChartRecognition: Bool
    let visualize: Bool
    
    init(
        file: String,
        fileType: Int = 1,
        useDocOrientationClassify: Bool = false,
        useDocUnwarping: Bool = false,
        useLayoutDetection: Bool = true,
        useChartRecognition: Bool = false,
        visualize: Bool = false
    ) {
        self.file = file
        self.fileType = fileType
        self.useDocOrientationClassify = useDocOrientationClassify
        self.useDocUnwarping = useDocUnwarping
        self.useLayoutDetection = useLayoutDetection
        self.useChartRecognition = useChartRecognition
        self.visualize = visualize
    }
}

// MARK: - PaddleOCR Response

struct PaddleOCRResponse: Decodable {
    let logId: String?
    let errorCode: Int
    let errorMsg: String
    let result: PaddleOCRResult?
}

struct PaddleOCRResult: Decodable {
    let layoutParsingResults: [PaddleLayoutResult]
    let dataInfo: PaddleDataInfo?
}

struct PaddleLayoutResult: Decodable {
    let prunedResult: PaddlePrunedResult?
    let markdown: PaddleMarkdown?
    let outputImages: [String: String]?
    let inputImage: String?
}

struct PaddlePrunedResult: Decodable {
    let modelSettings: PaddleModelSettings?
    let parsingResList: [PaddleBlock]?
    
    enum CodingKeys: String, CodingKey {
        case modelSettings = "model_settings"
        case parsingResList = "parsing_res_list"
    }
}

struct PaddleModelSettings: Decodable {
    let useDocPreprocessor: Bool?
    let useLayoutDetection: Bool?
    let useChartRecognition: Bool?
    let formatBlockContent: Bool?
    
    enum CodingKeys: String, CodingKey {
        case useDocPreprocessor = "use_doc_preprocessor"
        case useLayoutDetection = "use_layout_detection"
        case useChartRecognition = "use_chart_recognition"
        case formatBlockContent = "format_block_content"
    }
}

struct PaddleBlock: Decodable, Identifiable {
    var id: Int { blockId }
    
    let blockBbox: [Double]
    let blockLabel: String
    let blockContent: String
    let blockId: Int
    let blockOrder: Int?
    
    enum CodingKeys: String, CodingKey {
        case blockBbox = "block_bbox"
        case blockLabel = "block_label"
        case blockContent = "block_content"
        case blockId = "block_id"
        case blockOrder = "block_order"
    }
    
    /// 转换为像素 CGRect
    func toPixelRect() -> CGRect {
        guard blockBbox.count >= 4 else { return .zero }
        return CGRect(
            x: blockBbox[0],
            y: blockBbox[1],
            width: blockBbox[2] - blockBbox[0],
            height: blockBbox[3] - blockBbox[1]
        )
    }
}

struct PaddleMarkdown: Decodable {
    let text: String
    let images: [String: String]?
    let isStart: Bool?
    let isEnd: Bool?
}

struct PaddleDataInfo: Decodable {}

// MARK: - OCR Result (统一结果模型)

struct OCRResult {
    let rawText: String
    let markdownText: String?
    let blocks: [OCRBlock]
    let processedAt: Date
}

struct OCRBlock: Identifiable {
    let id = UUID()
    let text: String
    let label: String  // "text", "table", "formula", "chart" 等
    let bbox: CGRect   // 像素坐标
}

// MARK: - OCR Request Config (profiles)

/// OCR 请求参数配置（用于不同场景的默认参数；不要求暴露在 UI）
struct OCRRequestConfig: Sendable {
    var useDocOrientationClassify: Bool
    var useDocUnwarping: Bool
    var useLayoutDetection: Bool
    var useChartRecognition: Bool
    var visualize: Bool

    static let `default` = OCRRequestConfig(
        useDocOrientationClassify: false,
        useDocUnwarping: false,
        useLayoutDetection: true,
        useChartRecognition: false,
        visualize: false
    )

    /// 聊天截图建议默认值（可后续再调优）
    static let wechatChat = OCRRequestConfig(
        useDocOrientationClassify: true,
        useDocUnwarping: false,
        useLayoutDetection: true,
        useChartRecognition: false,
        visualize: false
    )
}

// MARK: - OCR Service Error

enum OCRServiceError: LocalizedError {
    case notConfigured
    case invalidURL
    case invalidImage
    case invalidResponse
    case httpError(Int)
    case apiError(String)
    case noResult
    
    var errorDescription: String? {
        switch self {
        case .notConfigured: return "PaddleOCR API 未配置"
        case .invalidURL: return "无效的 API URL"
        case .invalidImage: return "无效的图片数据"
        case .invalidResponse: return "无效的响应"
        case .httpError(let code): return "HTTP 错误: \(code)"
        case .apiError(let msg): return "API 错误: \(msg)"
        case .noResult: return "OCR 返回空结果"
        }
    }
}
