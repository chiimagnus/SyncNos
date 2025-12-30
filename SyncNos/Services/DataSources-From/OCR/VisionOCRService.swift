import Foundation
import AppKit
@preconcurrency import Vision

// MARK: - Vision OCR Service

/// Apple Vision 框架 OCR 服务
/// 使用原生 VNRecognizeTextRequest 进行文本识别，无需外部 API
/// 适用于 macOS 14.0+ / iOS 17.0+
final class VisionOCRService: OCRAPIServiceProtocol, @unchecked Sendable {
    
    // MARK: - Dependencies
    
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
        
        /// 去重时允许的水平偏差（像素）
        static let deduplicateXTolerance: CGFloat = 50
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
        
        let imageSize = CGSize(width: CGFloat(cgImage.width), height: CGFloat(cgImage.height))
        let languageCodes = configStore.effectiveLanguageCodes
        let isAutoDetect = configStore.isAutoDetectEnabled
        
        logger.info("[VisionOCR] Starting recognition, image size: \(Int(imageSize.width))x\(Int(imageSize.height))")
        logger.debug("[VisionOCR] Language mode: \(isAutoDetect ? "automatic" : "manual"), languages: \(languageCodes.joined(separator: ", "))")
        
        // 根据图像高度决定处理方式
        if imageSize.height > Constants.sliceThresholdHeight {
            logger.info("[VisionOCR] 🔪 Image height \(Int(imageSize.height))px exceeds threshold \(Int(Constants.sliceThresholdHeight))px, using slice processing")
            return try await recognizeWithSlicing(
                cgImage: cgImage,
                imageSize: imageSize,
                languageCodes: languageCodes,
                isAutoDetect: isAutoDetect
            )
        }
        
        return try await recognizeStandard(
            cgImage: cgImage,
            imageSize: imageSize,
            languageCodes: languageCodes,
            isAutoDetect: isAutoDetect
        )
    }
    
    func testConnection() async throws -> Bool {
        logger.info("[VisionOCR] Connection test: Always available (native framework)")
        return true
    }
}

// MARK: - Standard Recognition (标准识别)

private extension VisionOCRService {
    
    /// 标准 OCR 识别（不分片）
    func recognizeStandard(
        cgImage: CGImage,
        imageSize: CGSize,
        languageCodes: [String],
        isAutoDetect: Bool
    ) async throws -> (result: OCRResult, rawResponse: Data, requestJSON: Data) {
        let request = createTextRecognitionRequest(languageCodes: languageCodes, isAutoDetect: isAutoDetect)
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self else {
                    continuation.resume(throwing: OCRServiceError.invalidResponse)
                    return
                }
                
                do {
                    try handler.perform([request])
                    
                    guard let observations = request.results else {
                        self.logger.warning("[VisionOCR] No observations returned")
                        continuation.resume(returning: self.createEmptyResult(imageSize: imageSize))
                        return
                    }
                    
                    let result = self.buildResult(
                        observations: observations,
                        imageSize: imageSize
                    )
                    continuation.resume(returning: result)
                    
                } catch {
                    self.logger.error("[VisionOCR] Recognition failed: \(error.localizedDescription)")
                    continuation.resume(throwing: error)
                }
            }
        }
    }
    
    /// 对单张图片进行 OCR（用于分片处理）
    func recognizeSingle(
        cgImage: CGImage,
        imageSize: CGSize,
        languageCodes: [String],
        isAutoDetect: Bool
    ) async throws -> (observations: [VNRecognizedTextObservation], blocks: [OCRBlock]) {
        let request = createTextRecognitionRequest(languageCodes: languageCodes, isAutoDetect: isAutoDetect)
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self else {
                    continuation.resume(throwing: OCRServiceError.invalidResponse)
                    return
                }
                
                do {
                    try handler.perform([request])
                    let observations = request.results ?? []
                    let blocks = self.convertToOCRBlocks(observations: observations, imageSize: imageSize)
                    continuation.resume(returning: (observations, blocks))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }
}

// MARK: - Slice Processing (长图片分片处理)

private extension VisionOCRService {
    
    /// 对超长图片进行分片 OCR 处理
    func recognizeWithSlicing(
        cgImage: CGImage,
        imageSize: CGSize,
        languageCodes: [String],
        isAutoDetect: Bool
    ) async throws -> (result: OCRResult, rawResponse: Data, requestJSON: Data) {
        let slices = calculateSlices(imageHeight: imageSize.height)
        logger.info("[VisionOCR] 🔪 Slicing image into \(slices.count) parts")
        
        var allBlocks: [OCRBlock] = []
        var allRawDicts: [[String: Any]] = []
        var allObservations: [VNRecognizedTextObservation] = []
        
        for (index, slice) in slices.enumerated() {
            logger.debug("[VisionOCR] 🔪 Processing slice \(index + 1)/\(slices.count): y=\(Int(slice.y)), height=\(Int(slice.height))")
            
            guard let slicedImage = cropImage(cgImage, slice: slice, imageWidth: Int(imageSize.width)) else {
                logger.warning("[VisionOCR] ⚠️ Failed to crop slice \(index + 1)")
                continue
            }
            
            let sliceSize = CGSize(width: imageSize.width, height: slice.height)
            let (observations, blocks) = try await recognizeSingle(
                cgImage: slicedImage,
                imageSize: sliceSize,
                languageCodes: languageCodes,
                isAutoDetect: isAutoDetect
            )
            
            // 调整 Y 坐标并收集结果
            let adjustedBlocks = adjustBlocksYOffset(blocks, yOffset: slice.y)
            allBlocks.append(contentsOf: adjustedBlocks)
            allObservations.append(contentsOf: observations)
            
            let rawDicts = observationsToDict(observations, imageSize: sliceSize)
                .map { adjustRawDictYOffset($0, yOffset: slice.y) }
            allRawDicts.append(contentsOf: rawDicts)
        }
        
        // 去重并构建结果
        let deduplicatedBlocks = deduplicateBlocks(allBlocks)
        logger.info("[VisionOCR] 🔪 Slice processing completed: \(allBlocks.count) blocks → \(deduplicatedBlocks.count) after deduplication")
        
        let result = OCRResult(
            rawText: deduplicatedBlocks.map(\.text).joined(separator: "\n"),
            markdownText: nil,
            blocks: deduplicatedBlocks,
            processedAt: Date(),
            coordinateSize: imageSize
        )
        
        let rawData = (try? JSONSerialization.data(withJSONObject: allRawDicts)) ?? Data()
        logRecognitionDetails(observations: allObservations, blocks: deduplicatedBlocks)
        
        return (result: result, rawResponse: rawData, requestJSON: Data())
    }
    
    /// 计算分片区域
    func calculateSlices(imageHeight: CGFloat) -> [(y: CGFloat, height: CGFloat)] {
        var slices: [(y: CGFloat, height: CGFloat)] = []
        var currentY: CGFloat = 0
        
        while currentY < imageHeight {
            let remainingHeight = imageHeight - currentY
            let sliceHeight = min(Constants.sliceMaxHeight, remainingHeight)
            slices.append((y: currentY, height: sliceHeight))
            
            currentY += sliceHeight - Constants.sliceOverlap
            
            if currentY >= imageHeight - Constants.sliceOverlap {
                break
            }
        }
        
        return slices
    }
    
    /// 裁剪图片
    func cropImage(_ cgImage: CGImage, slice: (y: CGFloat, height: CGFloat), imageWidth: Int) -> CGImage? {
        let cropRect = CGRect(x: 0, y: slice.y, width: CGFloat(imageWidth), height: slice.height)
        return cgImage.cropping(to: cropRect)
    }
    
    /// 调整 blocks 的 Y 坐标偏移
    func adjustBlocksYOffset(_ blocks: [OCRBlock], yOffset: CGFloat) -> [OCRBlock] {
        blocks.map { block in
            let adjustedBbox = CGRect(
                x: block.bbox.origin.x,
                y: block.bbox.origin.y + yOffset,
                width: block.bbox.width,
                height: block.bbox.height
            )
            return OCRBlock(text: block.text, label: block.label, bbox: adjustedBbox)
        }
    }
    
    /// 调整 raw dict 的 Y 坐标偏移
    func adjustRawDictYOffset(_ dict: [String: Any], yOffset: CGFloat) -> [String: Any] {
        var adjusted = dict
        if var bbox = dict["boundingBox"] as? [String: CGFloat] {
            bbox["y"] = (bbox["y"] ?? 0) + yOffset
            adjusted["boundingBox"] = bbox
        }
        return adjusted
    }
    
    /// 去重：移除重叠区域产生的重复文本块
    func deduplicateBlocks(_ blocks: [OCRBlock]) -> [OCRBlock] {
        var result: [OCRBlock] = []
        
        for block in blocks {
            let isDuplicate = result.contains { existing in
                guard existing.text == block.text else { return false }
                
                let yDifference = abs(existing.bbox.midY - block.bbox.midY)
                guard yDifference < Constants.sliceOverlap else { return false }
                
                let xDifference = abs(existing.bbox.midX - block.bbox.midX)
                return xDifference < Constants.deduplicateXTolerance
            }
            
            if !isDuplicate {
                result.append(block)
            }
        }
        
        return result
    }
}

// MARK: - Request & Result Building (请求与结果构建)

private extension VisionOCRService {
    
    /// 创建文本识别请求
    func createTextRecognitionRequest(languageCodes: [String], isAutoDetect: Bool) -> VNRecognizeTextRequest {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.minimumTextHeight = Constants.minimumTextHeight
        request.recognitionLanguages = languageCodes
        
        if #available(macOS 14.0, *) {
            request.revision = VNRecognizeTextRequestRevision3
            request.automaticallyDetectsLanguage = isAutoDetect
        } else {
            request.revision = VNRecognizeTextRequestRevision2
        }
        
        return request
    }
    
    /// 构建 OCR 结果
    func buildResult(
        observations: [VNRecognizedTextObservation],
        imageSize: CGSize
    ) -> (result: OCRResult, rawResponse: Data, requestJSON: Data) {
        let blocks = convertToOCRBlocks(observations: observations, imageSize: imageSize)
        
        let result = OCRResult(
            rawText: blocks.map(\.text).joined(separator: "\n"),
            markdownText: nil,
            blocks: blocks,
            processedAt: Date(),
            coordinateSize: imageSize
        )
        
        let rawDict = observationsToDict(observations, imageSize: imageSize)
        let rawData = (try? JSONSerialization.data(withJSONObject: rawDict)) ?? Data()
        
        logRecognitionDetails(observations: observations, blocks: blocks)
        
        return (result: result, rawResponse: rawData, requestJSON: Data())
    }
    
    /// 创建空结果
    func createEmptyResult(imageSize: CGSize) -> (result: OCRResult, rawResponse: Data, requestJSON: Data) {
        let emptyResult = OCRResult(
            rawText: "",
            markdownText: nil,
            blocks: [],
            processedAt: Date(),
            coordinateSize: imageSize
        )
        return (result: emptyResult, rawResponse: Data(), requestJSON: Data())
    }
}

// MARK: - Coordinate Conversion (坐标转换)

private extension VisionOCRService {
    
    /// 将 VNRecognizedTextObservation 转换为 OCRBlock
    /// Vision 归一化坐标系：原点在左下角，Y 轴向上
    /// 需要手动翻转 Y 坐标以匹配图像坐标系（原点左上角，Y 轴向下）
    func convertToOCRBlocks(
        observations: [VNRecognizedTextObservation],
        imageSize: CGSize
    ) -> [OCRBlock] {
        observations.compactMap { observation -> OCRBlock? in
            guard let topCandidate = observation.topCandidates(1).first else { return nil }
            
            let text = topCandidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            
            let pixelRect = convertNormalizedToPixelRect(observation.boundingBox, imageSize: imageSize)
            return OCRBlock(text: text, label: "text", bbox: pixelRect)
        }
    }
    
    /// 将 observations 转换为字典（用于 rawResponse）
    func observationsToDict(
        _ observations: [VNRecognizedTextObservation],
        imageSize: CGSize
    ) -> [[String: Any]] {
        observations.compactMap { obs -> [String: Any]? in
            guard let text = obs.topCandidates(1).first else { return nil }
            
            let pixelRect = convertNormalizedToPixelRect(obs.boundingBox, imageSize: imageSize)
            
            return [
                "text": text.string,
                "confidence": text.confidence,
                "boundingBox": [
                    "x": pixelRect.origin.x,
                    "y": pixelRect.origin.y,
                    "width": pixelRect.width,
                    "height": pixelRect.height
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
    
    /// 将 Vision 归一化坐标转换为像素坐标（原点左上角）
    func convertNormalizedToPixelRect(_ normalizedBox: CGRect, imageSize: CGSize) -> CGRect {
        let x = normalizedBox.origin.x * imageSize.width
        let y = imageSize.height * (1 - normalizedBox.origin.y - normalizedBox.height)
        let width = normalizedBox.width * imageSize.width
        let height = normalizedBox.height * imageSize.height
        return CGRect(x: x, y: y, width: width, height: height)
    }
}

// MARK: - Logging & Script Detection (日志与语言检测)

private extension VisionOCRService {
    
    /// 记录识别详情日志
    func logRecognitionDetails(
        observations: [VNRecognizedTextObservation],
        blocks: [OCRBlock]
    ) {
        let totalObservations = observations.count
        let validBlocks = blocks.count
        
        let confidences = observations.compactMap { $0.topCandidates(1).first?.confidence }
        let avgConfidence = confidences.isEmpty ? 0 : confidences.reduce(0, +) / Float(confidences.count)
        let minConfidence = confidences.min() ?? 0
        let maxConfidence = confidences.max() ?? 0
        
        logger.info("[VisionOCR] ✅ Recognition completed: \(validBlocks) blocks (from \(totalObservations) observations)")
        logger.info("[VisionOCR] 📊 Confidence: avg=\(String(format: "%.2f", avgConfidence)), min=\(String(format: "%.2f", minConfidence)), max=\(String(format: "%.2f", maxConfidence))")
        
        let detectedScripts = blocks.reduce(into: Set<String>()) { result, block in
            result.formUnion(detectScripts(in: block.text))
        }
        
        if !detectedScripts.isEmpty {
            logger.info("[VisionOCR] 🌐 Detected scripts: \(detectedScripts.sorted().joined(separator: ", "))")
        }
        
        logBlockPreview(blocks: blocks, observations: observations)
    }
    
    /// 输出前几个识别结果预览
    func logBlockPreview(blocks: [OCRBlock], observations: [VNRecognizedTextObservation]) {
        let previewCount = min(5, blocks.count)
        guard previewCount > 0 else { return }
        
        logger.debug("[VisionOCR] 📝 First \(previewCount) blocks:")
        for (index, block) in blocks.prefix(previewCount).enumerated() {
            let truncatedText = block.text.count > 50
                ? String(block.text.prefix(50)) + "..."
                : block.text
            let conf = observations[safe: index].flatMap { $0.topCandidates(1).first?.confidence } ?? 0
            logger.debug("[VisionOCR]   [\(index + 1)] \"\(truncatedText)\" (conf: \(String(format: "%.2f", conf)))")
        }
    }
    
    /// 检测文本中使用的书写系统
    func detectScripts(in text: String) -> Set<String> {
        var scripts: Set<String> = []
        
        for scalar in text.unicodeScalars {
            if let script = detectScript(for: scalar) {
                scripts.insert(script)
            }
        }
        
        return scripts
    }
    
    /// 检测单个字符的书写系统
    func detectScript(for scalar: Unicode.Scalar) -> String? {
        switch scalar.value {
        case 0x4E00...0x9FFF, 0x3400...0x4DBF:
            return "CJK (Chinese/Japanese Kanji)"
        case 0x3040...0x309F:
            return "Hiragana (Japanese)"
        case 0x30A0...0x30FF:
            return "Katakana (Japanese)"
        case 0xAC00...0xD7AF, 0x1100...0x11FF:
            return "Hangul (Korean)"
        case 0x0600...0x06FF:
            return "Arabic"
        case 0x0400...0x04FF:
            return "Cyrillic (Russian/Ukrainian)"
        case 0x0E00...0x0E7F:
            return "Thai"
        case 0x0041...0x005A, 0x0061...0x007A:
            return "Latin (English/European)"
        default:
            return nil
        }
    }
}

// MARK: - Array Safe Subscript

private extension Array {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
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
