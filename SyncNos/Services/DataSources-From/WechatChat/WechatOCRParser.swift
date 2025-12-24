import Foundation
import CoreGraphics

// MARK: - Wechat OCR Parser (V2)
//
// 目标：
// - 仅解析“气泡消息”（我/对方），支持私聊 + 群聊（昵称绑定）。
// - 不做系统消息关键词表，不做时间戳展示路径。
// - 主要依赖 bbox 的几何特征（过滤/合并/方向判定/昵称绑定）。
//

final class WechatOCRParser {
    private let config: WechatChatParseConfig

    init(config: WechatChatParseConfig = .default) {
        self.config = config
    }

    func parse(ocrResult: OCRResult, imageSize: CGSize) -> [WechatMessage] {
        guard imageSize.width > 0, imageSize.height > 0 else { return [] }

        let blocks = normalizeBlocks(ocrResult.blocks, imageSize: imageSize)
        guard !blocks.isEmpty else { return [] }

        let lines = groupBlocksIntoLines(blocks)
        let candidates = groupLinesIntoCandidates(lines)
        let systemFlags = classifyCenteredSystemFlags(candidates, imageWidth: imageSize.width)

        let bubbleCandidates: [MessageCandidate] = zip(candidates, systemFlags)
            .compactMap { cand, isSystem in isSystem ? nil : cand }

        let directedBubbles = classifyDirection(bubbleCandidates, imageWidth: imageSize.width)
        var bubbleIndex = 0

        var messages: [WechatMessage] = []
        messages.reserveCapacity(candidates.count)

        for (idx, cand) in candidates.enumerated() {
            if systemFlags[idx] {
                messages.append(WechatMessage(
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
                messages.append(WechatMessage(
                    content: bubble.text,
                    isFromMe: bubble.isFromMe,
                    senderName: nil,
                    kind: .text,
                    bbox: bubble.bbox,
                    order: messages.count
                ))
            }
        }

        return messages
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

private extension WechatOCRParser {
    /// 识别位于 X 轴中间的系统/时间戳文本（不做关键词识别）
    ///
    /// 思路：中心文本通常同时满足：
    /// - 与左右边界距离都较大（minEdgeDistance 大）
    /// - centerX 接近 0.5
    ///
    /// 为了避免误把“短气泡”当成系统消息：
    /// - 第一步：对 minEdgeDistance 做 2-means 分布聚类，取“更大的一簇”作为系统候选（更居中）
    /// - 第二步：在系统候选中，再对 abs(bias) 做 2-means（取更小的一簇），确保“左右留白均衡”才算系统/时间戳
    /// - 最后：叠加 centerX 接近 0.5 的约束
    func classifyCenteredSystemFlags(_ candidates: [MessageCandidate], imageWidth: CGFloat) -> [Bool] {
        guard !candidates.isEmpty, imageWidth > 0 else { return [] }

        let minEdgeDistances: [Double] = candidates.map { cand in
            let left = Double(cand.bbox.minX / imageWidth)
            let right = Double(1 - cand.bbox.maxX / imageWidth)
            return min(left, right)
        }

        let centerXs: [Double] = candidates.map { cand in
            Double(cand.bbox.midX / imageWidth)
        }

        let biases: [Double] = candidates.map { cand in
            Double((cand.bbox.minX + cand.bbox.maxX) / imageWidth) - 1.0
        }

        // Step 1: minEdgeDistance 聚类（更大的簇更可能是“居中系统/时间戳”）
        let (edgeAssignments, edgeCenters) = kMeans2(values: minEdgeDistances, iterations: 6)
        let centeredCluster = edgeCenters.0 >= edgeCenters.1 ? 0 : 1
        let minCenter = min(edgeCenters.0, edgeCenters.1)
        let maxCenter = max(edgeCenters.0, edgeCenters.1)

        // 若两簇分离不明显，则不标记系统消息（避免误判导致“漏气泡”）
        let hasClearSplit = (maxCenter - minCenter) >= 0.12 && maxCenter >= 0.18
        guard hasClearSplit else {
            return Array(repeating: false, count: candidates.count)
        }

        // Step 2: 在“居中簇”里，再用 abs(bias) 聚类（更小的一簇才是真系统/时间戳）
        var candidateIndices: [Int] = []
        candidateIndices.reserveCapacity(candidates.count)

        for i in candidates.indices {
            let centered = abs(centerXs[i] - 0.5) <= 0.12
            if edgeAssignments[i] == centeredCluster, centered {
                candidateIndices.append(i)
            }
        }

        guard !candidateIndices.isEmpty else {
            return Array(repeating: false, count: candidates.count)
        }

        let absBiasValues: [Double] = candidateIndices.map { abs(biases[$0]) }
        let (biasAssignments, biasCenters) = kMeans2(values: absBiasValues, iterations: 6)
        let systemBiasCluster = biasCenters.0 <= biasCenters.1 ? 0 : 1

        var flags = Array(repeating: false, count: candidates.count)
        for (j, idx) in candidateIndices.enumerated() {
            if biasAssignments[j] == systemBiasCluster {
                flags[idx] = true
            }
        }

        return flags
    }
}

// MARK: - Normalization & Filtering

private extension WechatOCRParser {
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

private extension WechatOCRParser {
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

private extension WechatOCRParser {
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

private extension WechatOCRParser {
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


