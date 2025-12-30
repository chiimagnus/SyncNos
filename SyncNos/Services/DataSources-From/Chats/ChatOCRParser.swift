import Foundation
import CoreGraphics

// MARK: - Chat OCR Parser (V2)
//
// 目标：
// - 仅解析"气泡消息"（我/对方），支持私聊 + 群聊（昵称绑定）。
// - 不做系统消息关键词表，不做时间戳展示路径。
// - 主要依赖 bbox 的几何特征（过滤/合并/方向判定/昵称绑定）。
//

/// Parse statistics returned alongside messages for debugging
struct ChatParseStatistics {
    let inputBlockCount: Int
    let normalizedBlockCount: Int
    let lineCount: Int
    let candidateCount: Int
    let systemMessageCount: Int
    let leftBubbleCount: Int
    let rightBubbleCount: Int
    
    var description: String {
        "[OCR Parse] input=\(inputBlockCount) → normalized=\(normalizedBlockCount) → lines=\(lineCount) → candidates=\(candidateCount) | system=\(systemMessageCount) left=\(leftBubbleCount) right=\(rightBubbleCount)"
    }
}

final class ChatOCRParser {
    private let config: ChatParseConfig
    private let logger: LoggerServiceProtocol

    init(config: ChatParseConfig = .default, logger: LoggerServiceProtocol = DIContainer.shared.loggerService) {
        self.config = config
        self.logger = logger
    }
    
    /// Parse OCR result into chat messages (legacy API without statistics)
    func parse(ocrResult: OCRResult, imageSize: CGSize) -> [ChatMessage] {
        let (messages, _) = parseWithStatistics(ocrResult: ocrResult, imageSize: imageSize)
        return messages
    }

    /// Parse OCR result into chat messages with detailed statistics for debugging
    func parseWithStatistics(ocrResult: OCRResult, imageSize: CGSize) -> (messages: [ChatMessage], statistics: ChatParseStatistics) {
        let inputBlockCount = ocrResult.blocks.count
        
        guard imageSize.width > 0, imageSize.height > 0 else {
            let stats = ChatParseStatistics(
                inputBlockCount: inputBlockCount,
                normalizedBlockCount: 0,
                lineCount: 0,
                candidateCount: 0,
                systemMessageCount: 0,
                leftBubbleCount: 0,
                rightBubbleCount: 0
            )
            logger.debug(stats.description)
            return ([], stats)
        }

        let blocks = normalizeBlocks(ocrResult.blocks, imageSize: imageSize)
        let normalizedBlockCount = blocks.count
        
        guard !blocks.isEmpty else {
            let stats = ChatParseStatistics(
                inputBlockCount: inputBlockCount,
                normalizedBlockCount: 0,
                lineCount: 0,
                candidateCount: 0,
                systemMessageCount: 0,
                leftBubbleCount: 0,
                rightBubbleCount: 0
            )
            logger.debug(stats.description)
            return ([], stats)
        }

        let lines = groupBlocksIntoLines(blocks)
        let lineCount = lines.count
        
        let candidates = groupLinesIntoCandidates(lines)
        let candidateCount = candidates.count
        
        let systemFlags = classifyCenteredSystemFlags(candidates, imageWidth: imageSize.width)
        let systemMessageCount = systemFlags.filter { $0 }.count

        let bubbleCandidates: [MessageCandidate] = zip(candidates, systemFlags)
            .compactMap { cand, isSystem in isSystem ? nil : cand }

        let directedBubbles = classifyDirection(bubbleCandidates, imageWidth: imageSize.width)
        
        // Count left (other) and right (me) bubbles
        let rightBubbleCount = directedBubbles.filter { $0.isFromMe }.count
        let leftBubbleCount = directedBubbles.count - rightBubbleCount
        
        var bubbleIndex = 0
        var messages: [ChatMessage] = []
        messages.reserveCapacity(candidates.count)

        for (idx, cand) in candidates.enumerated() {
            if systemFlags[idx] {
                messages.append(ChatMessage(
                    content: cand.text,
                    isFromMe: false,
                    senderName: nil,
                    kind: .system,
                    bbox: cand.bbox,
                    order: messages.count
                ))
            } else {
                let bubble = directedBubbles[bubbleIndex]
                bubbleIndex += 1
                messages.append(ChatMessage(
                    content: bubble.text,
                    isFromMe: bubble.isFromMe,
                    senderName: nil,
                    kind: .text,
                    bbox: bubble.bbox,
                    order: messages.count
                ))
            }
        }

        let stats = ChatParseStatistics(
            inputBlockCount: inputBlockCount,
            normalizedBlockCount: normalizedBlockCount,
            lineCount: lineCount,
            candidateCount: candidateCount,
            systemMessageCount: systemMessageCount,
            leftBubbleCount: leftBubbleCount,
            rightBubbleCount: rightBubbleCount
        )
        
        logger.debug(stats.description)
        
        return (messages, stats)
    }
}

// MARK: - Internal Models

private struct NormalizedBlock {
    var text: String
    var label: String
    var bbox: CGRect
}

private struct Line {
    var blocks: [NormalizedBlock]
    var bbox: CGRect

    var text: String {
        let sorted = blocks.sorted { $0.bbox.minX < $1.bbox.minX }
        return sorted.map(\.text).joined(separator: " ")
    }
}

private struct MessageCandidate {
    var lines: [Line]
    var bbox: CGRect

    var text: String {
        lines.map(\.text).joined(separator: "\n")
    }
}

private struct DirectedCandidate {
    var text: String
    var bbox: CGRect
    var isFromMe: Bool
}

// MARK: - Centered System/Timestamp Detection (geometry only)

private extension ChatOCRParser {
    /// 识别位于 X 轴中间的系统/时间戳文本（不做关键词识别）
    ///
    /// 改进版算法（2025-12-30）：
    /// 使用绝对几何特征直接检测居中文本，不依赖聚类
    /// 原因：聚类算法在边界情况下不稳定，同样位置的时间戳可能被分到不同簇
    func classifyCenteredSystemFlags(_ candidates: [MessageCandidate], imageWidth: CGFloat) -> [Bool] {
        guard !candidates.isEmpty, imageWidth > 0 else { return [] }

        var flags = Array(repeating: false, count: candidates.count)
        
        // 计算所有候选的几何特征
        var allBiases: [Double] = []
        allBiases.reserveCapacity(candidates.count)
        
        for (i, cand) in candidates.enumerated() {
            let left = Double(cand.bbox.minX / imageWidth)
            let right = Double(1 - cand.bbox.maxX / imageWidth)
            let centerX = Double(cand.bbox.midX / imageWidth)
            let bias = Double((cand.bbox.minX + cand.bbox.maxX) / imageWidth) - 1.0
            let relativeWidth = Double(cand.bbox.width / imageWidth)
            
            allBiases.append(bias)
            
            // 直接使用绝对阈值检测居中文本
            // 条件1：centerX 接近 0.5（误差 ±0.1）
            let isCentered = abs(centerX - 0.5) <= 0.10
            
            // 条件2：左右留白差异小（bias 接近 0，误差 ±0.1）
            let isBalanced = abs(bias) <= 0.10
            
            // 条件3：两侧都有明显留白（至少 25% 的边距）
            // 这区分了居中文本和靠边的气泡
            let hasMargins = min(left, right) >= 0.25
            
            // 条件4：宽度较窄（相对宽度 < 0.5）
            // 时间戳和系统消息通常比气泡窄
            let isNarrow = relativeWidth < 0.50
            
            if isCentered && isBalanced && hasMargins && isNarrow {
                flags[i] = true
            }
        }
        
        // 额外检查：如果存在明显的左右气泡分布，对于 bias 接近 0 的候选额外放宽检测
        // 这处理了聚类边界效应
        if let minBias = allBiases.min(), let maxBias = allBiases.max() {
            // 存在明显的左右分布（bias 范围 > 0.5）
            let hasLeftRightDistribution = (maxBias - minBias) > 0.5
            
            if hasLeftRightDistribution {
                for (i, cand) in candidates.enumerated() {
                    // 已经标记的跳过
                    if flags[i] { continue }
                    
                    let bias = allBiases[i]
                    let centerX = Double(cand.bbox.midX / imageWidth)
                    let relativeWidth = Double(cand.bbox.width / imageWidth)
                    
                    // 如果 bias 明显小于左右气泡（接近 0），且位置居中
                    // 这捕获了那些被聚类边界效应漏掉的时间戳
                    let isBiasNearZero = abs(bias) <= 0.15
                    let isCentered = abs(centerX - 0.5) <= 0.12
                    let isNarrow = relativeWidth < 0.50
                    
                    // bias 必须明显小于左右气泡的 bias
                    let isDistinctFromBubbles = abs(bias) < (maxBias - minBias) * 0.3
                    
                    if isBiasNearZero && isCentered && isNarrow && isDistinctFromBubbles {
                        flags[i] = true
                    }
                }
            }
        }
        
        return flags
    }
}

// MARK: - Normalization & Filtering

private extension ChatOCRParser {
    func normalizeBlocks(_ blocks: [OCRBlock], imageSize: CGSize) -> [NormalizedBlock] {
        return blocks.compactMap { block in
            let text = block.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }

            // 简化：不做顶部/底部过滤；只过滤明显无效 bbox
            guard block.bbox.width > 1, block.bbox.height > 1 else { return nil }

            return NormalizedBlock(text: text, label: block.label, bbox: block.bbox)
        }
        .sorted {
            if $0.bbox.minY != $1.bbox.minY { return $0.bbox.minY < $1.bbox.minY }
            if $0.bbox.minX != $1.bbox.minX { return $0.bbox.minX < $1.bbox.minX }
            return $0.bbox.width < $1.bbox.width
        }
    }
}

// MARK: - Grouping: Blocks -> Lines

private extension ChatOCRParser {
    func groupBlocksIntoLines(_ blocks: [NormalizedBlock]) -> [Line] {
        var lines: [Line] = []

        for block in blocks {
            if let index = bestLineIndex(for: block, in: lines) {
                lines[index].blocks.append(block)
                lines[index].bbox = lines[index].bbox.union(block.bbox)
            } else {
                lines.append(Line(blocks: [block], bbox: block.bbox))
            }
        }

        // 重新按阅读顺序排序 line（同一 y 段可能有左右两列）
        return lines.sorted {
            if $0.bbox.minY != $1.bbox.minY { return $0.bbox.minY < $1.bbox.minY }
            return $0.bbox.minX < $1.bbox.minX
        }
    }

    func bestLineIndex(for block: NormalizedBlock, in lines: [Line]) -> Int? {
        var best: (index: Int, score: Double)?

        for (i, line) in lines.enumerated() {
            let overlapRatio = verticalOverlapRatio(a: line.bbox, b: block.bbox)
            guard overlapRatio >= config.minLineVerticalOverlapRatio else { continue }

            let gap = horizontalGapPx(a: line.bbox, b: block.bbox)
            guard gap <= config.maxLineHorizontalGapPx else { continue }

            // score 越小越好（优先水平更近，其次 y 更近）
            let dy = abs(Double(line.bbox.midY - block.bbox.midY))
            let score = gap + dy * 0.05

            if best == nil || score < best!.score {
                best = (i, score)
            }
        }

        return best?.index
    }
}

// MARK: - Grouping: Lines -> Message Candidates

private extension ChatOCRParser {
    func groupLinesIntoCandidates(_ lines: [Line]) -> [MessageCandidate] {
        var candidates: [MessageCandidate] = []

        for line in lines {
            if let index = bestCandidateIndex(for: line, in: candidates) {
                candidates[index].lines.append(line)
                candidates[index].bbox = candidates[index].bbox.union(line.bbox)
            } else {
                candidates.append(MessageCandidate(lines: [line], bbox: line.bbox))
            }
        }

        return candidates.sorted {
            if $0.bbox.minY != $1.bbox.minY { return $0.bbox.minY < $1.bbox.minY }
            return $0.bbox.minX < $1.bbox.minX
        }
    }

    func bestCandidateIndex(for line: Line, in candidates: [MessageCandidate]) -> Int? {
        var best: (index: Int, score: Double)?

        for (i, cand) in candidates.enumerated() {
            // 必须在候选的下方（阅读顺序）
            let gapY = Double(line.bbox.minY - cand.bbox.maxY)
            guard gapY >= 0, gapY <= config.maxMessageLineGapPx else { continue }

            // 水平对齐：minX 或 maxX 接近即可
            let minXDelta = abs(Double(line.bbox.minX - cand.bbox.minX))
            let maxXDelta = abs(Double(line.bbox.maxX - cand.bbox.maxX))
            let align = min(minXDelta, maxXDelta)
            guard align <= config.maxMessageXAlignDeltaPx else { continue }

            let score = gapY + align * 0.5
            if best == nil || score < best!.score {
                best = (i, score)
            }
        }

        return best?.index
    }
}

// MARK: - Direction Classification (Data-driven)

private extension ChatOCRParser {
    func classifyDirection(_ candidates: [MessageCandidate], imageWidth: CGFloat) -> [DirectedCandidate] {
        guard !candidates.isEmpty, imageWidth > 0 else { return [] }

        // 使用“分布”而非固定阈值：
        // 以气泡到左右边界的相对距离差作为 1D 特征：
        // bias = leftDistance - rightDistance
        //      = (minX/width) - (1 - maxX/width)
        //      = (minX + maxX)/width - 1
        // bias 越大越偏右（更可能是“我”）

        let biases: [Double] = candidates.map { cand in
            Double((cand.bbox.minX + cand.bbox.maxX) / imageWidth) - 1.0
        }

        let (assignments, centers) = kMeans2(values: biases, iterations: 8)
        let rightCluster = centers.0 >= centers.1 ? 0 : 1

        return zip(candidates, assignments).map { cand, cluster in
            DirectedCandidate(text: cand.text, bbox: cand.bbox, isFromMe: cluster == rightCluster)
        }
    }

    /// 1D k-means (k=2) on normalized values
    func kMeans2(values: [Double], iterations: Int) -> (assignments: [Int], centers: (Double, Double)) {
        guard !values.isEmpty else { return ([], (0, 0)) }

        var c0 = values.min() ?? 0
        var c1 = values.max() ?? 0

        // 全部相同：全部归为一个簇
        if c0 == c1 {
            return (Array(repeating: 0, count: values.count), (c0, c1))
        }

        var assignments = Array(repeating: 0, count: values.count)

        for _ in 0..<max(1, iterations) {
            var sum0: Double = 0
            var sum1: Double = 0
            var cnt0: Int = 0
            var cnt1: Int = 0

            for (idx, v) in values.enumerated() {
                let d0 = abs(v - c0)
                let d1 = abs(v - c1)
                let a = (d0 <= d1) ? 0 : 1
                assignments[idx] = a
                if a == 0 {
                    sum0 += v
                    cnt0 += 1
                } else {
                    sum1 += v
                    cnt1 += 1
                }
            }

            if cnt0 > 0 { c0 = sum0 / Double(cnt0) }
            if cnt1 > 0 { c1 = sum1 / Double(cnt1) }
        }

        return (assignments, (c0, c1))
    }
}

// MARK: - Geometry Helpers

private func verticalOverlapRatio(a: CGRect, b: CGRect) -> Double {
    let overlap = min(a.maxY, b.maxY) - max(a.minY, b.minY)
    guard overlap > 0 else { return 0 }
    let minHeight = min(a.height, b.height)
    guard minHeight > 0 else { return 0 }
    return Double(overlap / minHeight)
}

private func horizontalGapPx(a: CGRect, b: CGRect) -> Double {
    if a.maxX < b.minX { return Double(b.minX - a.maxX) }
    if b.maxX < a.minX { return Double(a.minX - b.maxX) }
    return 0
}


