import Foundation

/// BlockSplitter：按段落优先，再按可视字符（grapheme clusters）安全切分为不超过 maxLength 的段
final class BlockSplitter {
    /// 将文本切分为多个 chunk。优先在空行（段落边界）切分，其次按字符数安全切分。
    /// - Parameters:
    ///   - text: 原始文本
    ///   - maxLength: 每个 chunk 最大字符数（基于 Swift 可视字符 count）
    /// - Returns: 按序的 chunk 数组
    static func split(_ text: String, maxLength: Int = NotionSyncConfig.maxTextLengthPrimary) -> [String] {
        guard !text.isEmpty else { return [] }

        // 先将 CRLF 统一为 \n
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")

        // 以两个换行或更多（段落分隔）拆分段落，保留单行换行在段落内
        // 使用 \n\n 分割段落
        let paragraphs = normalized.components(separatedBy: "\n\n").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }

        var chunks: [String] = []

        func appendChunk(_ s: String) {
            if s.isEmpty { return }
            chunks.append(s)
        }

        for p in paragraphs where !p.isEmpty {
            // 如果单个段落本身小于等于 maxLength，尝试合并到最近的 chunk（如果合并后仍然小于等于maxLength）
            if let last = chunks.last, last.count + p.count + 2 <= maxLength {
                // 使用双换行作为段落间隔
                let merged = last + "\n\n" + p
                chunks[chunks.count - 1] = merged
                continue
            }

            if p.count <= maxLength {
                appendChunk(p)
                continue
            }

            // 段落过长，按 maxLength 安全切分
            var startIndex = p.startIndex
            while startIndex < p.endIndex {
                // 计算可达的 endIndex，基于 grapheme clusters的 offsetBy
                let endIndex = p.index(startIndex, offsetBy: maxLength, limitedBy: p.endIndex) ?? p.endIndex
                let slice = String(p[startIndex..<endIndex])
                appendChunk(slice)
                startIndex = endIndex
            }
        }

        // 如果文本里没有双换行分割（即 paragraphs 只有一个长段），则尝试按单行分割保留换行
        if chunks.isEmpty && !normalized.isEmpty {
            var start = normalized.startIndex
            while start < normalized.endIndex {
                let end = normalized.index(start, offsetBy: maxLength, limitedBy: normalized.endIndex) ?? normalized.endIndex
                let slice = String(normalized[start..<end])
                appendChunk(slice)
                start = end
            }
        }

        return chunks
    }
}
