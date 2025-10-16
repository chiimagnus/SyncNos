import Foundation

/// 生成 Markdown 预览文本，尽量在段落/代码块边界截断，并在需要时补齐围栏。
enum MarkdownPreviewBuilder {
    static func buildPreview(from source: String, maxCharacters: Int, preserveFences: Bool = true) -> String {
        if source.count <= maxCharacters { return source }

        // 粗略分段（按空行）
        let paragraphs = source.split(separator: "\n\n", omittingEmptySubsequences: false)
        var total = 0
        var result: [Substring] = []
        var endedInsideFence = false
        var fenceBalance = 0

        for para in paragraphs {
            let delta = para.count + 2 // 恢复分隔的两个换行
            if total + delta > maxCharacters { break }
            result.append(para)
            total += delta

            // 简单 fence 统计：出现 ``` 加 1，再次出现减 1
            if preserveFences {
                let ticks = para.components(separatedBy: "```")
                if ticks.count > 1 {
                    fenceBalance += (ticks.count - 1)
                }
            }
        }

        var preview = result.joined(separator: "\n\n")
        if preview.isEmpty {
            // 兜底：直接截断前 maxCharacters 字符
            let idx = source.index(source.startIndex, offsetBy: maxCharacters)
            preview = String(source[..<idx])
        }

        if preserveFences && fenceBalance % 2 != 0 {
            // 补齐未闭合的 fence
            preview.append("\n\n```")
            endedInsideFence = true
        }

        if !endedInsideFence {
            preview.append("\n\n…")
        }

        return preview
    }
}


