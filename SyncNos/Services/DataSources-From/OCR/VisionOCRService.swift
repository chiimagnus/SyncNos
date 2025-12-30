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
        
        /// 长图片分片处理阈值（像素）
        /// 超过此高度的图片会被分片处理，避免 Vision OCR 返回空结果
        /// Apple Silicon Mac 支持最大纹理尺寸约 16384x16384
        /// 设置为 16000px，接近 GPU 纹理限制但保留一些余量
        static let sliceThresholdHeight: CGFloat = 16000
        
        /// 分片最大高度（像素）
        /// 设置为 8000px，确保每个分片都在 Vision OCR 的安全处理范围内
        static let sliceMaxHeight: CGFloat = 8000
        
        /// 分片重叠区域（像素）
        /// 用于处理跨片文字，避免边界处文字丢失或重复
        static let sliceOverlap: CGFloat = 200
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
        
        // 检查是否需要分片处理
        if imageSize.height > Constants.sliceThresholdHeight {
            logger.info("[VisionOCR] 🔪 Image height \(Int(imageSize.height))px exceeds threshold \(Int(Constants.sliceThresholdHeight))px, using slice processing")
            return try await recognizeWithSlicing(cgImage: cgImage, imageSize: imageSize, languageCodes: languageCodes, isAutoDetect: isAutoDetect)
        }
        
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
    
    // MARK: - Slice Processing (长图片分片处理)
    
    /// 对超长图片进行分片 OCR 处理
    /// - Parameters:
    ///   - cgImage: 原始 CGImage
    ///   - imageSize: 图像尺寸
    ///   - languageCodes: 语言代码
    ///   - isAutoDetect: 是否自动检测语言
    /// - Returns: 合并后的 OCR 结果
    private func recognizeWithSlicing(
        cgImage: CGImage,
        imageSize: CGSize,
        languageCodes: [String],
        isAutoDetect: Bool
    ) async throws -> (result: OCRResult, rawResponse: Data, requestJSON: Data) {
        // 计算分片
        let slices = calculateSlices(imageHeight: imageSize.height)
        logger.info("[VisionOCR] 🔪 Slicing image into \(slices.count) parts")
        
        var allBlocks: [OCRBlock] = []
        var allRawDicts: [[String: Any]] = []
        var allObservations: [VNRecognizedTextObservation] = []
        
        for (index, slice) in slices.enumerated() {
            logger.debug("[VisionOCR] 🔪 Processing slice \(index + 1)/\(slices.count): y=\(Int(slice.y)), height=\(Int(slice.height))")
            
            // 裁剪图片
            guard let slicedImage = cropImage(cgImage, rect: slice, imageWidth: Int(imageSize.width)) else {
                logger.warning("[VisionOCR] ⚠️ Failed to crop slice \(index + 1)")
                continue
            }
            
            // 对分片进行 OCR
            let sliceSize = CGSize(width: imageSize.width, height: slice.height)
            let (observations, blocks) = try await recognizeSingleImage(
                cgImage: slicedImage,
                imageSize: sliceSize,
                languageCodes: languageCodes,
                isAutoDetect: isAutoDetect
            )
            
            // 调整 bbox 的 Y 坐标（加上分片的起始 Y 偏移）
            let adjustedBlocks = blocks.map { block -> OCRBlock in
                let adjustedBbox = CGRect(
                    x: block.bbox.origin.x,
                    y: block.bbox.origin.y + slice.y,  // 加上分片的 Y 偏移
                    width: block.bbox.width,
                    height: block.bbox.height
                )
                return OCRBlock(text: block.text, label: block.label, bbox: adjustedBbox)
            }
            
            allBlocks.append(contentsOf: adjustedBlocks)
            allObservations.append(contentsOf: observations)
            
            // 构造 raw dict（调整 Y 坐标）
            let rawDicts = observationsToDict(observations, imageSize: sliceSize).map { dict -> [String: Any] in
                var adjusted = dict
                if var bbox = dict["boundingBox"] as? [String: CGFloat] {
                    bbox["y"] = (bbox["y"] ?? 0) + slice.y
                    adjusted["boundingBox"] = bbox
                }
                return adjusted
            }
            allRawDicts.append(contentsOf: rawDicts)
        }
        
        // 去重：处理重叠区域可能产生的重复文本块
        let deduplicatedBlocks = deduplicateBlocks(allBlocks)
        
        logger.info("[VisionOCR] 🔪 Slice processing completed: \(allBlocks.count) blocks → \(deduplicatedBlocks.count) after deduplication")
        
        // 构造最终结果
        let result = OCRResult(
            rawText: deduplicatedBlocks.map(\.text).joined(separator: "\n"),
            markdownText: nil,
            blocks: deduplicatedBlocks,
            processedAt: Date(),
            coordinateSize: imageSize
        )
        
        let rawData = (try? JSONSerialization.data(withJSONObject: allRawDicts)) ?? Data()
        
        // 日志
        logRecognitionDetails(observations: allObservations, blocks: deduplicatedBlocks)
        
        return (result: result, rawResponse: rawData, requestJSON: Data())
    }
    
    /// 计算分片区域
    /// - Parameter imageHeight: 图像高度
    /// - Returns: 分片区域数组 (y, height)
    private func calculateSlices(imageHeight: CGFloat) -> [(y: CGFloat, height: CGFloat)] {
        var slices: [(y: CGFloat, height: CGFloat)] = []
        var currentY: CGFloat = 0
        
        while currentY < imageHeight {
            let remainingHeight = imageHeight - currentY
            let sliceHeight = min(Constants.sliceMaxHeight, remainingHeight)
            slices.append((y: currentY, height: sliceHeight))
            
            // 下一个分片的起始位置（减去重叠区域）
            currentY += sliceHeight - Constants.sliceOverlap
            
            // 如果剩余高度小于重叠区域，直接结束
            if currentY >= imageHeight - Constants.sliceOverlap {
                break
            }
        }
        
        return slices
    }
    
    /// 裁剪图片
    private func cropImage(_ cgImage: CGImage, rect: (y: CGFloat, height: CGFloat), imageWidth: Int) -> CGImage? {
        let cropRect = CGRect(
            x: 0,
            y: rect.y,
            width: CGFloat(imageWidth),
            height: rect.height
        )
        return cgImage.cropping(to: cropRect)
    }
    
    /// 对单张图片进行 OCR（不分片）
    private func recognizeSingleImage(
        cgImage: CGImage,
        imageSize: CGSize,
        languageCodes: [String],
        isAutoDetect: Bool
    ) async throws -> (observations: [VNRecognizedTextObservation], blocks: [OCRBlock]) {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.minimumTextHeight = Constants.minimumTextHeight
        
        if #available(macOS 14.0, *) {
            request.revision = VNRecognizeTextRequestRevision3
            request.automaticallyDetectsLanguage = isAutoDetect
        } else {
            request.revision = VNRecognizeTextRequestRevision2
        }
        
        request.recognitionLanguages = languageCodes
        
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self = self else {
                    continuation.resume(throwing: OCRServiceError.invalidResponse)
                    return
                }
                
                do {
                    try handler.perform([request])
                    
                    let observations = request.results ?? []
                    let blocks = self.convertToOCRBlocks(observations: observations, imageSize: imageSize)
                    
                    continuation.resume(returning: (observations: observations, blocks: blocks))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }
    
    /// 去重：移除重叠区域产生的重复文本块
    /// 使用文本内容 + 近似位置判断是否为重复
    private func deduplicateBlocks(_ blocks: [OCRBlock]) -> [OCRBlock] {
        var result: [OCRBlock] = []
        
        for block in blocks {
            let isDuplicate = result.contains { existing in
                // 文本完全相同
                guard existing.text == block.text else { return false }
                
                // Y 坐标接近（在重叠区域内）
                let yDifference = abs(existing.bbox.midY - block.bbox.midY)
                guard yDifference < Constants.sliceOverlap else { return false }
                
                // X 坐标接近
                let xDifference = abs(existing.bbox.midX - block.bbox.midX)
                return xDifference < 50  // 允许 50px 的水平偏差
            }
            
            if !isDuplicate {
                result.append(block)
            }
        }
        
        return result
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
