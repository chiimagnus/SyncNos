import Foundation

// MARK: - Search Text Matcher

/// 统一的文本匹配结果（用于面板 snippet 高亮）
struct SearchTextMatch: Sendable, Equatable {
    let snippet: String
    /// 命中范围（相对 snippet，UTF16 offset）
    let snippetMatchRangesUTF16: [Range<Int>]
    /// snippet 内命中次数（用于相关度排序）
    let matchCount: Int
    /// 命中窗口紧凑度（越小越相关）
    let compactness: Int
}

/// 文本匹配器：支持多 token AND 匹配 + 生成高亮 snippet
enum SearchTextMatcher {
    private struct Occurrence {
        let tokenIndex: Int
        let rangeUTF16: Range<Int>
    }

    // MARK: - Public API

    /// 用于全文高亮：返回原文中的命中范围（UTF16 offset）。
    /// 规则与 `match(text:query:)` 一致：query 多 token 时为 AND 匹配。
    static func matchRangesUTF16(text: String, query: String) -> [Range<Int>]? {
        guard let tokens = tokenize(query: query) else { return nil }
        guard let occurrences = findOccurrences(text: text, tokens: tokens) else { return nil }
        let merged = mergeRanges(occurrences.map(\.rangeUTF16))
        return merged.isEmpty ? nil : merged
    }

    static func match(text: String, query: String, snippetLimit: Int = 180) -> SearchTextMatch? {
        guard let tokens = tokenize(query: query) else { return nil }

        let textUTF16Count = text.utf16.count
        guard textUTF16Count > 0 else { return nil }

        guard let occurrences = findOccurrences(text: text, tokens: tokens) else { return nil }

        // 选择“最紧凑”的命中窗口（至少包含每个 token 的一次命中）
        let bestWindow = bestCoverWindow(occurrences: occurrences, tokenCount: tokens.count)
        let windowStart = bestWindow.start
        let windowEnd = bestWindow.end
        let compactness = max(windowEnd - windowStart, 0)

        // 生成 snippet 区间
        let snippetRange = computeSnippetRange(
            textUTF16Count: textUTF16Count,
            windowStart: windowStart,
            windowEnd: windowEnd,
            snippetLimit: max(snippetLimit, 40)
        )

        let snippetStart = snippetRange.lowerBound
        let snippetEnd = snippetRange.upperBound

        let prefixEllipsis = snippetStart > 0 ? "…" : ""
        let suffixEllipsis = snippetEnd < textUTF16Count ? "…" : ""

        let startIndex = String.Index(utf16Offset: snippetStart, in: text)
        let endIndex = String.Index(utf16Offset: snippetEnd, in: text)
        let core = String(text[startIndex..<endIndex])
        let snippet = prefixEllipsis + core + suffixEllipsis

        // 计算 snippet 内命中范围（只保留落在 snippet 区间内的命中）
        let prefixShift = prefixEllipsis.utf16.count
        var snippetRanges: [Range<Int>] = []
        snippetRanges.reserveCapacity(8)

        for occ in occurrences {
            let r = occ.rangeUTF16
            let clippedLower = max(r.lowerBound, snippetStart)
            let clippedUpper = min(r.upperBound, snippetEnd)
            guard clippedLower < clippedUpper else { continue }
            let relLower = (clippedLower - snippetStart) + prefixShift
            let relUpper = (clippedUpper - snippetStart) + prefixShift
            snippetRanges.append(relLower..<relUpper)
        }

        let mergedRanges = mergeRanges(snippetRanges)
        let matchCount = mergedRanges.count

        return SearchTextMatch(
            snippet: snippet,
            snippetMatchRangesUTF16: mergedRanges,
            matchCount: matchCount,
            compactness: compactness
        )
    }

    // MARK: - Tokenize & Occurrences

    private static func tokenize(query: String) -> [String]? {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedQuery.isEmpty else { return nil }

        let tokens = trimmedQuery
            .split(whereSeparator: { $0.isWhitespace })
            .map { String($0) }
            .filter { !$0.isEmpty }

        return tokens.isEmpty ? nil : tokens
    }

    /// 扫描所有 token 的命中（AND 匹配：任一 token 未命中则返回 nil）
    private static func findOccurrences(text: String, tokens: [String]) -> [Occurrence]? {
        guard !text.isEmpty, !tokens.isEmpty else { return nil }

        var occurrences: [Occurrence] = []
        occurrences.reserveCapacity(16)

        for (tokenIndex, token) in tokens.enumerated() {
            let tokenTrimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !tokenTrimmed.isEmpty else { continue }

            var foundAny = false
            var searchRange = text.startIndex..<text.endIndex

            while let r = text.range(
                of: tokenTrimmed,
                options: [.caseInsensitive, .diacriticInsensitive],
                range: searchRange
            ) {
                foundAny = true
                let lower = r.lowerBound.utf16Offset(in: text)
                let upper = r.upperBound.utf16Offset(in: text)
                if lower < upper {
                    occurrences.append(
                        Occurrence(tokenIndex: tokenIndex, rangeUTF16: lower..<upper)
                    )
                }
                if r.upperBound >= text.endIndex { break }
                searchRange = r.upperBound..<text.endIndex
            }

            // AND 匹配：任一 token 未命中则整体不命中
            if !foundAny {
                return nil
            }
        }

        guard !occurrences.isEmpty else { return nil }
        occurrences.sort { a, b in
            if a.rangeUTF16.lowerBound == b.rangeUTF16.lowerBound {
                return a.rangeUTF16.upperBound < b.rangeUTF16.upperBound
            }
            return a.rangeUTF16.lowerBound < b.rangeUTF16.lowerBound
        }
        return occurrences
    }

    // MARK: - Window Selection

    private static func bestCoverWindow(occurrences: [Occurrence], tokenCount: Int) -> (start: Int, end: Int) {
        guard tokenCount > 1 else {
            // 单 token：取第一个命中范围作为窗口
            let first = occurrences.first!
            return (first.rangeUTF16.lowerBound, first.rangeUTF16.upperBound)
        }

        var counts = Array(repeating: 0, count: tokenCount)
        var satisfied = 0
        var left = 0
        var currentMaxEnd = 0

        var bestStart = occurrences.first!.rangeUTF16.lowerBound
        var bestEnd = occurrences.first!.rangeUTF16.upperBound
        var bestLen = Int.max

        for right in 0..<occurrences.count {
            let rOcc = occurrences[right]
            if counts[rOcc.tokenIndex] == 0 {
                satisfied += 1
            }
            counts[rOcc.tokenIndex] += 1
            currentMaxEnd = max(currentMaxEnd, rOcc.rangeUTF16.upperBound)

            while satisfied == tokenCount && left <= right {
                let lOcc = occurrences[left]
                let windowStart = lOcc.rangeUTF16.lowerBound
                let windowEnd = currentMaxEnd
                let windowLen = windowEnd - windowStart
                if windowLen < bestLen {
                    bestLen = windowLen
                    bestStart = windowStart
                    bestEnd = windowEnd
                }

                // shrink from left
                counts[lOcc.tokenIndex] -= 1
                if counts[lOcc.tokenIndex] == 0 {
                    satisfied -= 1
                }
                left += 1

                // 如果移除了当前最大 end，需要重算（MVP：线性重算即可）
                if lOcc.rangeUTF16.upperBound == currentMaxEnd {
                    currentMaxEnd = 0
                    if left <= right {
                        for i in left...right {
                            currentMaxEnd = max(currentMaxEnd, occurrences[i].rangeUTF16.upperBound)
                        }
                    }
                }
            }
        }

        return (bestStart, bestEnd)
    }

    private static func computeSnippetRange(
        textUTF16Count: Int,
        windowStart: Int,
        windowEnd: Int,
        snippetLimit: Int
    ) -> Range<Int> {
        let safeWindowStart = max(0, min(windowStart, textUTF16Count))
        let safeWindowEnd = max(0, min(windowEnd, textUTF16Count))
        let windowLen = max(safeWindowEnd - safeWindowStart, 0)

        if textUTF16Count <= snippetLimit {
            return 0..<textUTF16Count
        }

        var start = safeWindowStart
        var end = safeWindowEnd

        // 扩展窗口至 snippetLimit（尽量左右均衡）
        let remaining = max(snippetLimit - windowLen, 0)
        let leftPad = remaining / 2
        let rightPad = remaining - leftPad

        start = max(0, start - leftPad)
        end = min(textUTF16Count, end + rightPad)

        // 若还不够，补齐到 snippetLimit
        if end - start < snippetLimit {
            let need = snippetLimit - (end - start)
            start = max(0, start - need)
            if end - start < snippetLimit {
                end = min(textUTF16Count, start + snippetLimit)
            }
        }

        // 保证窗口一定覆盖命中
        if end < safeWindowEnd {
            end = safeWindowEnd
            start = max(0, end - snippetLimit)
        }

        if start > safeWindowStart {
            start = safeWindowStart
            end = min(textUTF16Count, start + snippetLimit)
        }

        if start >= end {
            start = max(0, min(safeWindowStart, textUTF16Count - 1))
            end = min(textUTF16Count, start + min(snippetLimit, textUTF16Count - start))
        }

        return start..<end
    }

    // MARK: - Range Helpers

    private static func mergeRanges(_ ranges: [Range<Int>]) -> [Range<Int>] {
        guard !ranges.isEmpty else { return [] }
        let sorted = ranges.sorted { a, b in
            if a.lowerBound == b.lowerBound { return a.upperBound < b.upperBound }
            return a.lowerBound < b.lowerBound
        }
        var result: [Range<Int>] = []
        result.reserveCapacity(sorted.count)

        var current = sorted[0]
        for r in sorted.dropFirst() {
            if r.lowerBound <= current.upperBound {
                current = current.lowerBound..<max(current.upperBound, r.upperBound)
            } else {
                result.append(current)
                current = r
            }
        }
        result.append(current)
        return result
    }
}
