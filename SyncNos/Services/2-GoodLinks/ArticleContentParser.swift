import Foundation

// MARK: - Article Block Model
enum ArticleBlock: Equatable {
    case paragraph(String)
    case image(URL)
}

// MARK: - Parser
struct ArticleContentParser {
    /// 支持识别的图片扩展名（用于原始 URL 匹配）
    private static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]

    /// 解析全文文本为段落和图片 URL 的有序序列，保留相对位置。
    /// - Parameter text: GoodLinks `content.content` 原始文本
    /// - Returns: 有序 `ArticleBlock` 数组
    func parseToBlocks(_ text: String) -> [ArticleBlock] {
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return []
        }

        // 统一换行
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")

        // 正则：Markdown 图片、HTML 图片、行内原始图片 URL（整行）
        let markdownPattern = #"!\[[^\]]*\]\((https?:[^\s)]+)\)"#
        let htmlImgPattern = #"<img[^>]*src=[\"'](https?://[^\"']+)[\"'][^>]*>"#

        var blocks: [ArticleBlock] = []
        var currentParagraphLines: [String] = []

        func flushParagraphIfNeeded() {
            guard !currentParagraphLines.isEmpty else { return }
            let paragraph = currentParagraphLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !paragraph.isEmpty { blocks.append(.paragraph(paragraph)) }
            currentParagraphLines.removeAll(keepingCapacity: true)
        }

        // 行级扫描，遇到图片则先冲刷段落，再插入图片块
        normalized.components(separatedBy: "\n").forEach { rawLine in
            let line = rawLine
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)

            // 空行：作为段落分隔符
            if trimmed.isEmpty {
                flushParagraphIfNeeded()
                return
            }

            var mutable = line
            var localImages: [URL] = []

            // 1) Markdown 图片（可多个）
            if let regex = try? NSRegularExpression(pattern: markdownPattern, options: []) {
                let matches = regex.matches(in: mutable, options: [], range: NSRange(location: 0, length: (mutable as NSString).length))
                // 从后往前替换，避免 range 偏移
                for m in matches.reversed() {
                    if m.numberOfRanges >= 2 {
                        let urlRange = m.range(at: 1)
                        if let swiftRange = Range(urlRange, in: mutable) {
                            if let url = URL(string: String(mutable[swiftRange])) { localImages.insert(url, at: 0) }
                        }
                    }
                    if let fullRange = Range(m.range(at: 0), in: mutable) {
                        mutable.replaceSubrange(fullRange, with: " ")
                    }
                }
            }

            // 2) HTML 图片（可多个）
            if let regex = try? NSRegularExpression(pattern: htmlImgPattern, options: [.caseInsensitive]) {
                let matches = regex.matches(in: mutable, options: [], range: NSRange(location: 0, length: (mutable as NSString).length))
                for m in matches.reversed() {
                    if m.numberOfRanges >= 2 {
                        let urlRange = m.range(at: 1)
                        if let swiftRange = Range(urlRange, in: mutable) {
                            if let url = URL(string: String(mutable[swiftRange])) { localImages.insert(url, at: 0) }
                        }
                    }
                    if let fullRange = Range(m.range(at: 0), in: mutable) {
                        mutable.replaceSubrange(fullRange, with: " ")
                    }
                }
            }

            // 3) 行为原始图片 URL（完整行）
            if let rawURL = URL(string: trimmed), Self.looksLikeImageURL(rawURL) {
                // 先 flush 段落，再插入图片
                flushParagraphIfNeeded()
                blocks.append(.image(rawURL))
                return
            }

            // 行内剩余文本
            let leftover = mutable.trimmingCharacters(in: .whitespacesAndNewlines)
            if !leftover.isEmpty {
                currentParagraphLines.append(leftover)
            }

            // 插入本行图片（按出现顺序）
            if !localImages.isEmpty {
                flushParagraphIfNeeded()
                for url in localImages { blocks.append(.image(url)) }
            }
        }

        // 末尾 flush
        flushParagraphIfNeeded()
        return blocks
    }

    private static func looksLikeImageURL(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), (scheme == "http" || scheme == "https") else { return false }
        let path = url.path.lowercased()
        if let ext = path.split(separator: ".").last.map({ String($0) }), imageExtensions.contains(ext) {
            return true
        }
        return false
    }
}


