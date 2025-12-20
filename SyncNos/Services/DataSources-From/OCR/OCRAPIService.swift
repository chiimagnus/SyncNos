import Foundation
import AppKit

// MARK: - OCR API Service Protocol

protocol OCRAPIServiceProtocol {
    /// 识别图片（纯文字，无布局）
    func recognizeFreeOCR(_ image: NSImage) async throws -> String
    
    /// 识别图片（带 bbox）
    func recognizeWithGrounding(_ image: NSImage) async throws -> OCRResultWithBBox
    
    /// 测试 API 连接
    func testConnection() async throws -> Bool
}

// MARK: - OCR API Service

/// DeepSeek-OCR API 服务（硅基流动）
/// 注意：DeepSeek-OCR 只接受预定义的 prompts，不是通用 LLM
final class OCRAPIService: OCRAPIServiceProtocol {
    
    private let configStore: OCRConfigStoreProtocol
    private let logger: LoggerServiceProtocol
    private let session: URLSession
    
    // MARK: - Constants
    
    private enum Constants {
        static let timeout: TimeInterval = 120
        static let maxTokens = 8192
        static let temperature = 0.0
    }
    
    /// DeepSeek-OCR 预定义 Prompts（不支持自定义）
    /// 参考: https://github.com/deepseek-ai/DeepSeek-OCR
    private enum Prompts {
        /// 纯 OCR，无布局信息
        static let freeOCR = "Free OCR."
        
        /// 带 grounding（bbox）的 OCR
        static let groundingOCR = "<|grounding|>OCR this image."
        
        /// 文档转 Markdown（带 bbox）
        static let groundingDocument = "<|grounding|>Convert the document to markdown."
    }
    
    // MARK: - Init
    
    init(
        configStore: OCRConfigStoreProtocol = OCRConfigStore.shared,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.configStore = configStore
        self.logger = logger
        
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = Constants.timeout
        config.timeoutIntervalForResource = Constants.timeout
        self.session = URLSession(configuration: config)
    }
    
    // MARK: - Public Methods
    
    func recognizeFreeOCR(_ image: NSImage) async throws -> String {
        guard configStore.isConfigured else {
            throw OCRServiceError.apiKeyNotConfigured
        }
        
        logger.info("[OCR] Starting Free OCR...")
        let base64Image = try encodeImageToBase64(image)
        let response = try await sendOCRRequest(imageBase64: base64Image, prompt: Prompts.freeOCR)
        
        guard let content = response.choices?.first?.message?.content else {
            if let error = response.error {
                throw OCRServiceError.apiError(error.message ?? "Unknown API error")
            }
            throw OCRServiceError.unknown("No response content")
        }
        
        return content
    }
    
    func recognizeWithGrounding(_ image: NSImage) async throws -> OCRResultWithBBox {
        guard configStore.isConfigured else {
            throw OCRServiceError.apiKeyNotConfigured
        }
        
        logger.info("[OCR] Starting Grounding OCR...")
        let base64Image = try encodeImageToBase64(image)
        let response = try await sendOCRRequest(imageBase64: base64Image, prompt: Prompts.groundingOCR)
        
        guard let rawText = response.choices?.first?.message?.content else {
            if let error = response.error {
                throw OCRServiceError.apiError(error.message ?? "Unknown API error")
            }
            throw OCRServiceError.unknown("No response content")
        }
        
        let textBlocks = parseBBoxOutput(from: rawText)
        
        return OCRResultWithBBox(
            rawText: rawText,
            textBlocks: textBlocks,
            processedAt: Date(),
            sourceImage: image,
            tokenUsage: response.usage
        )
    }
    
    func testConnection() async throws -> Bool {
        guard configStore.isConfigured else {
            throw OCRServiceError.apiKeyNotConfigured
        }
        
        let testImage = createTestImage()
        let base64Image = try encodeImageToBase64(testImage)
        let response = try await sendOCRRequest(imageBase64: base64Image, prompt: Prompts.freeOCR)
        
        if let error = response.error {
            logger.error("[OCR] Connection test failed: \(error.message ?? "Unknown")")
            return false
        }
        
        logger.info("[OCR] Connection test successful")
        return response.choices != nil && !response.choices!.isEmpty
    }
    
    // MARK: - Private Methods
    
    private func sendOCRRequest(imageBase64: String, prompt: String) async throws -> OCRResponse {
        guard let url = URL(string: "\(OCRConfigStore.baseURL)/chat/completions") else {
            throw OCRServiceError.unknown("Invalid API URL")
        }
        
        guard let apiKey = configStore.apiKey else {
            throw OCRServiceError.apiKeyNotConfigured
        }
        
        // DeepSeek-OCR prompt 格式: <image>\n{prompt}
        let fullPrompt = "<image>\n\(prompt)"
        
        let request = OCRRequest(
            model: OCRConfigStore.model,
            messages: [
                OCRRequestMessage(
                    role: "user",
                    content: [
                        .text(fullPrompt),
                        .imageURL(url: "data:image/jpeg;base64,\(imageBase64)")
                    ]
                )
            ],
            maxTokens: Constants.maxTokens,
            temperature: Constants.temperature
        )
        
        var httpRequest = URLRequest(url: url)
        httpRequest.httpMethod = "POST"
        httpRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        httpRequest.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        httpRequest.httpBody = try JSONEncoder().encode(request)
        
        logger.debug("[OCR] Sending request, prompt: \(prompt)")
        
        let (data, httpResponse) = try await session.data(for: httpRequest)
        
        guard let response = httpResponse as? HTTPURLResponse else {
            throw OCRServiceError.networkError(NSError(domain: "OCR", code: -1))
        }
        
        if response.statusCode == 429 {
            throw OCRServiceError.rateLimitExceeded
        }
        
        if response.statusCode >= 400 {
            if let errorResponse = try? JSONDecoder().decode(OCRResponse.self, from: data),
               let error = errorResponse.error {
                throw OCRServiceError.apiError(error.message ?? "HTTP \(response.statusCode)")
            }
            throw OCRServiceError.apiError("HTTP \(response.statusCode)")
        }
        
        return try JSONDecoder().decode(OCRResponse.self, from: data)
    }
    
    private func encodeImageToBase64(_ image: NSImage) throws -> String {
        guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            throw OCRServiceError.invalidImageData
        }
        let bitmapRep = NSBitmapImageRep(cgImage: cgImage)
        guard let jpegData = bitmapRep.representation(using: .jpeg, properties: [.compressionFactor: 0.8]) else {
            throw OCRServiceError.invalidImageData
        }
        return jpegData.base64EncodedString()
    }
    
    private func createTestImage() -> NSImage {
        let size = NSSize(width: 100, height: 100)
        let image = NSImage(size: size)
        image.lockFocus()
        NSColor.white.setFill()
        NSRect(origin: .zero, size: size).fill()
        image.unlockFocus()
        return image
    }
    
    // MARK: - BBox Parsing
    
    /// 解析 DeepSeek-OCR grounding 输出
    /// 格式: <|ref|>文字<|/ref|><|det|>[[x1,y1,x2,y2]]<|/det|>
    private func parseBBoxOutput(from text: String) -> [OCRTextBlock] {
        var textBlocks: [OCRTextBlock] = []
        
        let pattern = #"<\|ref\|>(.*?)<\|/ref\|><\|det\|>(.*?)<\|/det\|>"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators]) else {
            return textBlocks
        }
        
        let nsText = text as NSString
        let matches = regex.matches(in: text, options: [], range: NSRange(location: 0, length: nsText.length))
        
        for match in matches {
            guard match.numberOfRanges >= 3 else { continue }
            
            let textContent = nsText.substring(with: match.range(at: 1))
            let coordString = nsText.substring(with: match.range(at: 2))
            let coords = parseCoordinates(from: coordString)
            
            for coord in coords where coord.count >= 4 {
                textBlocks.append(OCRTextBlock(text: textContent, rawBbox: coord))
            }
        }
        
        return textBlocks
    }
    
    private func parseCoordinates(from coordString: String) -> [[Int]] {
        var results: [[Int]] = []
        let cleaned = coordString.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "\n", with: "")
        let pattern = #"\[(\d+),(\d+),(\d+),(\d+)\]"#
        
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else {
            return results
        }
        
        let nsString = cleaned as NSString
        let matches = regex.matches(in: cleaned, options: [], range: NSRange(location: 0, length: nsString.length))
        
        for match in matches where match.numberOfRanges >= 5 {
            let x1 = Int(nsString.substring(with: match.range(at: 1))) ?? 0
            let y1 = Int(nsString.substring(with: match.range(at: 2))) ?? 0
            let x2 = Int(nsString.substring(with: match.range(at: 3))) ?? 0
            let y2 = Int(nsString.substring(with: match.range(at: 4))) ?? 0
            results.append([x1, y1, x2, y2])
        }
        
        return results
    }
}
