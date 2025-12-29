import Foundation
import AppKit
@preconcurrency import Vision

// MARK: - Vision OCR Service

/// Apple Vision 框架 OCR 服务
/// 使用原生 VNRecognizeTextRequest 进行文本识别，无需外部 API
/// 适用于 macOS 14.0+ / iOS 17.0+
final class VisionOCRService: OCRAPIServiceProtocol, @unchecked Sendable {
    
    private let logger: LoggerServiceProtocol
    private let configStore: OCRConfigStoreProtocol
    
    // MARK: - Constants
    
    private enum Constants {
        /// 最小文字高度比例（相对于图像高度）
        static let minimumTextHeight: Float = 0.01
    }
    
    // MARK: - Init
    
    init(
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        configStore: OCRConfigStoreProtocol = OCRConfigStore.shared
    ) {
        self.logger = logger
        self.configStore = configStore
    }
    
    // MARK: - OCRAPIServiceProtocol
    
    func recognize(_ image: NSImage) async throws -> OCRResult {
        let (result, _, _) = try await recognizeWithRaw(image, config: .default)
        return result
    }
    
    func recognizeWithRaw(
        _ image: NSImage,
        config: OCRRequestConfig
    ) async throws -> (result: OCRResult, rawResponse: Data, requestJSON: Data) {
        guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            throw OCRServiceError.invalidImage
        }
        
        let imageSize = CGSize(
            width: CGFloat(cgImage.width),
            height: CGFloat(cgImage.height)
        )
        
        // 获取语言配置
        let languageCodes = configStore.effectiveLanguageCodes
        let isAutoDetect = configStore.isAutoDetectEnabled
        
        logger.info("[VisionOCR] Starting recognition, image size: \(Int(imageSize.width))x\(Int(imageSize.height))")
        logger.debug("[VisionOCR] Language mode: \(isAutoDetect ? "automatic" : "manual"), languages: \(languageCodes.joined(separator: ", "))")
        
        // 创建识别请求
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.minimumTextHeight = Constants.minimumTextHeight
        
        // 使用最新版本（macOS 14+）
        if #available(macOS 14.0, *) {
            request.revision = VNRecognizeTextRequestRevision3
            // 根据配置决定是否启用自动语言检测
            request.automaticallyDetectsLanguage = isAutoDetect
        } else {
            request.revision = VNRecognizeTextRequestRevision2
        }
        
        // 设置识别语言
        request.recognitionLanguages = languageCodes
        
        // 执行请求
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self = self else {
                    continuation.resume(throwing: OCRServiceError.invalidResponse)
                    return
                }
                
                do {
                    try handler.perform([request])
                    
                    guard let observations = request.results else {
                        self.logger.warning("[VisionOCR] No observations returned")
                        // 返回空结果而不是抛出错误（图片可能确实没有文字）
                        let emptyResult = OCRResult(
                            rawText: "",
                            markdownText: nil,
                            blocks: [],
                            processedAt: Date(),
                            coordinateSize: imageSize
                        )
                        continuation.resume(returning: (
                            result: emptyResult,
                            rawResponse: Data(),
                            requestJSON: Data()
                        ))
                        return
                    }
                    
                    // 转换为 OCRBlock
                    let blocks = self.convertToOCRBlocks(
                        observations: observations,
                        imageSize: imageSize
                    )
                    
                    // 构造结果
                    let result = OCRResult(
                        rawText: blocks.map(\.text).joined(separator: "\n"),
                        markdownText: nil,
                        blocks: blocks,
                        processedAt: Date(),
                        coordinateSize: imageSize
                    )
                    
                    // 构造 raw response（用于调试和持久化）
                    let rawDict = self.observationsToDict(observations, imageSize: imageSize)
                    let rawData = (try? JSONSerialization.data(withJSONObject: rawDict)) ?? Data()
                    
                    // 详细日志：每个识别结果的文本和置信度
                    self.logRecognitionDetails(observations: observations, blocks: blocks)
                    
                    continuation.resume(returning: (
                        result: result,
                        rawResponse: rawData,
                        requestJSON: Data()
                    ))
                    
                } catch {
                    self.logger.error("[VisionOCR] Recognition failed: \(error.localizedDescription)")
                    continuation.resume(throwing: error)
                }
            }
        }
    }
    
    func testConnection() async throws -> Bool {
        // Vision 框架始终可用，无需连接测试
        logger.info("[VisionOCR] Connection test: Always available (native framework)")
        return true
    }
    
    // MARK: - Private Methods
    
    /// 将 VNRecognizedTextObservation 转换为 OCRBlock
    private func convertToOCRBlocks(
        observations: [VNRecognizedTextObservation],
        imageSize: CGSize
    ) -> [OCRBlock] {
        // Vision 归一化坐标系：原点在左下角，Y 轴向上
        // VNImageRectForNormalizedRect 只做缩放，不翻转 Y 轴
        // 需要手动翻转 Y 坐标以匹配图像坐标系（原点左上角，Y 轴向下）
        // 这样才能与标准图像坐标系保持一致
        
        let blocks = observations.compactMap { observation -> OCRBlock? in
            guard let topCandidate = observation.topCandidates(1).first else {
                return nil
            }
            
            let text = topCandidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            
            let normalizedBox = observation.boundingBox
            
            // 手动将 Vision 归一化坐标转换为图像坐标（原点左上角）
            // Y 轴翻转公式：newY = imageHeight - (normalizedY + normalizedHeight) * imageHeight
            //            = imageHeight * (1 - normalizedY - normalizedHeight)
            let x = normalizedBox.origin.x * imageSize.width
            let y = imageSize.height * (1 - normalizedBox.origin.y - normalizedBox.height)
            let width = normalizedBox.width * imageSize.width
            let height = normalizedBox.height * imageSize.height
            
            let pixelRect = CGRect(x: x, y: y, width: width, height: height)
            
            return OCRBlock(
                text: text,
                label: "text",  // Vision 只返回文本类型
                bbox: pixelRect
            )
        }
        
        return blocks
    }
    
    /// 将 observations 转换为字典（用于 rawResponse）
    private func observationsToDict(
        _ observations: [VNRecognizedTextObservation],
        imageSize: CGSize
    ) -> [[String: Any]] {
        return observations.compactMap { obs -> [String: Any]? in
            guard let text = obs.topCandidates(1).first else { return nil }
            
            let normalizedBox = obs.boundingBox
            
            // 手动将 Vision 归一化坐标转换为图像坐标（原点左上角）
            let x = normalizedBox.origin.x * imageSize.width
            let y = imageSize.height * (1 - normalizedBox.origin.y - normalizedBox.height)
            let width = normalizedBox.width * imageSize.width
            let height = normalizedBox.height * imageSize.height
            
            return [
                "text": text.string,
                "confidence": text.confidence,
                "boundingBox": [
                    "x": x,
                    "y": y,
                    "width": width,
                    "height": height
                ],
                "normalizedBoundingBox": [
                    "x": obs.boundingBox.origin.x,
                    "y": obs.boundingBox.origin.y,
                    "width": obs.boundingBox.width,
                    "height": obs.boundingBox.height
                ]
            ]
        }
    }
    
    /// 记录识别详情日志
    private func logRecognitionDetails(
        observations: [VNRecognizedTextObservation],
        blocks: [OCRBlock]
    ) {
        // 统计信息
        let totalObservations = observations.count
        let validBlocks = blocks.count
        
        // 计算平均置信度
        let confidences = observations.compactMap { $0.topCandidates(1).first?.confidence }
        let avgConfidence = confidences.isEmpty ? 0 : confidences.reduce(0, +) / Float(confidences.count)
        let minConfidence = confidences.min() ?? 0
        let maxConfidence = confidences.max() ?? 0
        
        logger.info("[VisionOCR] ✅ Recognition completed: \(validBlocks) blocks (from \(totalObservations) observations)")
        logger.info("[VisionOCR] 📊 Confidence: avg=\(String(format: "%.2f", avgConfidence)), min=\(String(format: "%.2f", minConfidence)), max=\(String(format: "%.2f", maxConfidence))")
        
        // 检测语言（通过字符范围）
        var detectedScripts: Set<String> = []
        for block in blocks {
            let scripts = detectScripts(in: block.text)
            detectedScripts.formUnion(scripts)
        }
        
        if !detectedScripts.isEmpty {
            logger.info("[VisionOCR] 🌐 Detected scripts: \(detectedScripts.sorted().joined(separator: ", "))")
        }
        
        // 输出前几个识别结果（调试用）
        let previewCount = min(5, blocks.count)
        if previewCount > 0 {
            logger.debug("[VisionOCR] 📝 First \(previewCount) blocks:")
            for (index, block) in blocks.prefix(previewCount).enumerated() {
                let truncatedText = block.text.count > 50 
                    ? String(block.text.prefix(50)) + "..." 
                    : block.text
                let conf = observations[safe: index].flatMap { $0.topCandidates(1).first?.confidence } ?? 0
                logger.debug("[VisionOCR]   [\(index + 1)] \"\(truncatedText)\" (conf: \(String(format: "%.2f", conf)))")
            }
        }
    }
    
    /// 检测文本中使用的书写系统
    private func detectScripts(in text: String) -> Set<String> {
        var scripts: Set<String> = []
        
        for scalar in text.unicodeScalars {
            if CharacterSet(charactersIn: "\u{4E00}"..."\u{9FFF}").contains(scalar) ||
               CharacterSet(charactersIn: "\u{3400}"..."\u{4DBF}").contains(scalar) {
                scripts.insert("CJK (Chinese/Japanese Kanji)")
            } else if CharacterSet(charactersIn: "\u{3040}"..."\u{309F}").contains(scalar) {
                scripts.insert("Hiragana (Japanese)")
            } else if CharacterSet(charactersIn: "\u{30A0}"..."\u{30FF}").contains(scalar) {
                scripts.insert("Katakana (Japanese)")
            } else if CharacterSet(charactersIn: "\u{AC00}"..."\u{D7AF}").contains(scalar) ||
                      CharacterSet(charactersIn: "\u{1100}"..."\u{11FF}").contains(scalar) {
                scripts.insert("Hangul (Korean)")
            } else if CharacterSet(charactersIn: "\u{0600}"..."\u{06FF}").contains(scalar) {
                scripts.insert("Arabic")
            } else if CharacterSet(charactersIn: "\u{0400}"..."\u{04FF}").contains(scalar) {
                scripts.insert("Cyrillic (Russian/Ukrainian)")
            } else if CharacterSet(charactersIn: "\u{0E00}"..."\u{0E7F}").contains(scalar) {
                scripts.insert("Thai")
            } else if CharacterSet.letters.contains(scalar) && 
                      CharacterSet(charactersIn: "a"..."z").contains(scalar) ||
                      CharacterSet(charactersIn: "A"..."Z").contains(scalar) {
                scripts.insert("Latin (English/European)")
            }
        }
        
        return scripts
    }
}

// MARK: - Array Safe Subscript

private extension Array {
    subscript(safe index: Index) -> Element? {
        return indices.contains(index) ? self[index] : nil
    }
}

// MARK: - Vision OCR Error

extension VisionOCRService {
    enum VisionOCRError: LocalizedError {
        case recognitionFailed(Error)
        
        var errorDescription: String? {
            switch self {
            case .recognitionFailed(let error):
                return "Vision OCR 识别失败: \(error.localizedDescription)"
            }
        }
    }
}
