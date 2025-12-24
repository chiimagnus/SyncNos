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
        let directed = classifyDirection(candidates, imageWidth: imageSize.width)

        return directed.enumerated().map { index, item in
            WechatMessage(
                content: item.text,
                isFromMe: item.isFromMe,
                senderName: nil, // 简化：私聊先不做昵称绑定
                kind: .text,
                bbox: item.bbox,
                order: index
            )
        }
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

        let otherMaxMinX = CGFloat(config.otherMessageMaxMinXRatio)
        let myMinMinX = CGFloat(config.myMessageMinMinXRatio)
        let myMinMaxX = CGFloat(config.myMessageMinMaxXRatio)
        let fallbackMyMinX = CGFloat(config.fallbackMyMessageMinXRatio)

        return candidates.map { cand in
            let relativeMinX = cand.bbox.minX / imageWidth
            let relativeMaxX = cand.bbox.maxX / imageWidth

            // 1) 对方：左侧起始 x 小
            if relativeMinX <= otherMaxMinX {
                return DirectedCandidate(text: cand.text, bbox: cand.bbox, isFromMe: false)
            }

            // 2) 我：右侧贴边（maxX 大）且起始也更靠右（minX 大）
            if relativeMaxX >= myMinMaxX, relativeMinX >= myMinMinX {
                return DirectedCandidate(text: cand.text, bbox: cand.bbox, isFromMe: true)
            }

            // 3) 兜底：minX 足够靠右则判为我
            return DirectedCandidate(text: cand.text, bbox: cand.bbox, isFromMe: relativeMinX >= fallbackMyMinX)
        }
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


