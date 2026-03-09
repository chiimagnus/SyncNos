import SwiftUI

// MARK: - HighlightedText

/// 将纯文本按命中范围渲染为带背景色高亮的 Text（用于全局搜索面板）
struct HighlightedText: View {
    let text: String
    /// 命中范围（UTF16 offset）
    let matchRangesUTF16: [Range<Int>]
    var highlightColor: Color = Color.yellow.opacity(0.35)

    var body: some View {
        Text(attributedText)
    }

    private var attributedText: AttributedString {
        var attributed = AttributedString(text)
        let merged = mergeRanges(matchRangesUTF16)
        for r in merged {
            guard r.lowerBound < r.upperBound else { continue }
            let lowerStringIndex = String.Index(utf16Offset: r.lowerBound, in: text)
            let upperStringIndex = String.Index(utf16Offset: r.upperBound, in: text)
            guard let lower = AttributedString.Index(lowerStringIndex, within: attributed),
                  let upper = AttributedString.Index(upperStringIndex, within: attributed),
                  lower < upper else { continue }

            let range = lower..<upper
            attributed[range].backgroundColor = highlightColor
        }
        return attributed
    }

    private func mergeRanges(_ ranges: [Range<Int>]) -> [Range<Int>] {
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

