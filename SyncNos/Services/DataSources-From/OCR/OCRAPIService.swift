import Foundation
import AppKit

// MARK: - OCR API Service Protocol

protocol OCRAPIServiceProtocol {
    /// 识别图片
    func recognize(_ image: NSImage) async throws -> OCRResult

    /// 识别图片（返回 raw JSON，便于持久化/回放/排障）
    func recognizeWithRaw(_ image: NSImage, config: OCRRequestConfig) async throws -> (result: OCRResult, rawResponse: Data, requestJSON: Data)
    
    /// 测试 API 连接
    func testConnection() async throws -> Bool
}

// MARK: - OCR API Service

/// PaddleOCR-VL API 服务（百度云）
/// Token 从 https://aistudio.baidu.com/paddleocr/task 获取
final class OCRAPIService: OCRAPIServiceProtocol {
    
    private let configStore: OCRConfigStoreProtocol
    private let logger: LoggerServiceProtocol
    private let session: URLSession
    
    // MARK: - Constants
    
    private enum Constants {
        static let timeout: TimeInterval = 120
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
    
    func recognize(_ image: NSImage) async throws -> OCRResult {
        let (result, _, _) = try await recognizeWithRaw(image, config: .default)
        return result
    }

    func recognizeWithRaw(_ image: NSImage, config: OCRRequestConfig) async throws -> (result: OCRResult, rawResponse: Data, requestJSON: Data) {
        guard configStore.isConfigured else {
            throw OCRServiceError.notConfigured
        }
        
        guard let apiURL = configStore.apiURL,
              let token = configStore.token else {
            throw OCRServiceError.notConfigured
        }
        
        guard let url = URL(string: apiURL) else {
            throw OCRServiceError.invalidURL
        }
        
        logger.info("[OCR] Starting PaddleOCR recognition...")
        
        let base64Image = try encodeImageToBase64(image)
        let request = PaddleOCRRequest(
            file: base64Image,
            fileType: 1,
            useDocOrientationClassify: config.useDocOrientationClassify,
            useDocUnwarping: config.useDocUnwarping,
            useLayoutDetection: config.useLayoutDetection,
            useChartRecognition: config.useChartRecognition,
            visualize: config.visualize
        )
        
        var httpRequest = URLRequest(url: url)
        httpRequest.httpMethod = "POST"
        httpRequest.setValue("token \(token)", forHTTPHeaderField: "Authorization")
        httpRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let requestJSON = try JSONEncoder().encode(request)
        httpRequest.httpBody = requestJSON
        
        logger.debug("[OCR] Sending request to \(apiURL)...")
        
        let (data, response) = try await session.data(for: httpRequest)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw OCRServiceError.invalidResponse
        }
        
        logger.debug("[OCR] Response status: \(httpResponse.statusCode)")
        
        if httpResponse.statusCode >= 400 {
            if let errorResponse = try? JSONDecoder().decode(PaddleOCRResponse.self, from: data) {
                throw OCRServiceError.apiError(errorResponse.errorMsg)
            }
            throw OCRServiceError.httpError(httpResponse.statusCode)
        }
        
        let ocrResponse = try JSONDecoder().decode(PaddleOCRResponse.self, from: data)
        
        if ocrResponse.errorCode != 0 {
            throw OCRServiceError.apiError(ocrResponse.errorMsg)
        }
        
        guard let responseResult = ocrResponse.result,
              let layout = responseResult.layoutParsingResults.first else {
            throw OCRServiceError.noResult
        }
        
        let blocks = layout.prunedResult?.parsingResList?.map { block in
            OCRBlock(
                text: block.blockContent,
                label: block.blockLabel,
                bbox: block.toPixelRect()
            )
        } ?? []
        
        let rawText = blocks.map(\.text).joined(separator: "\n")
        
        logger.info("[OCR] Recognition completed: \(blocks.count) blocks")
        
        let coordinateSize: CGSize? = {
            guard let w = responseResult.dataInfo?.width,
                  let h = responseResult.dataInfo?.height,
                  w > 0, h > 0 else {
                return nil
            }
            return CGSize(width: w, height: h)
        }()

        let ocrResult = OCRResult(
            rawText: rawText,
            markdownText: layout.markdown?.text,
            blocks: blocks,
            processedAt: Date(),
            coordinateSize: coordinateSize
        )
        return (result: ocrResult, rawResponse: data, requestJSON: requestJSON)
    }
    
    func testConnection() async throws -> Bool {
        guard configStore.isConfigured else {
            throw OCRServiceError.notConfigured
        }
        
        let testImage = createTestImage()
        
        do {
            let result = try await recognize(testImage)
            logger.info("[OCR] Connection test successful")
            return !result.rawText.isEmpty || result.blocks.isEmpty // 空图片可能没有内容
        } catch {
            logger.error("[OCR] Connection test failed: \(error)")
            throw error
        }
    }
    
    // MARK: - Private Methods
    
    private func encodeImageToBase64(_ image: NSImage) throws -> String {
        guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            throw OCRServiceError.invalidImage
        }
        let bitmapRep = NSBitmapImageRep(cgImage: cgImage)
        guard let jpegData = bitmapRep.representation(using: .jpeg, properties: [.compressionFactor: 0.85]) else {
            throw OCRServiceError.invalidImage
        }
        return jpegData.base64EncodedString()
    }
    
    private func createTestImage() -> NSImage {
        let size = NSSize(width: 200, height: 100)
        let image = NSImage(size: size)
        image.lockFocus()
        NSColor.white.setFill()
        NSRect(origin: .zero, size: size).fill()
        
        // 添加测试文字
        let text = "PaddleOCR Test"
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 24),
            .foregroundColor: NSColor.black
        ]
        text.draw(at: NSPoint(x: 20, y: 40), withAttributes: attrs)
        
        image.unlockFocus()
        return image
    }
}
