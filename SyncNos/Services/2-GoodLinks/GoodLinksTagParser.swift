import Foundation

// MARK: - GoodLinks Tag Parser
/// 负责 GoodLinks 标签字符串的解析与格式化。
/// 设计目标：
/// - 纯函数化、易测试
/// - 仅依赖 Foundation
/// - 支持 GoodLinks 原生分隔符（U+2063）与常见手工分隔符
enum GoodLinksTagParser {
    /// GoodLinks 使用的不可见分隔符 U+2063 (INVISIBLE SEPARATOR)
    static let tagSeparator: String = "\u{2063}"

    /// 将原始标签字符串解析成标签名称数组
    static func parseTagsString(_ raw: String?) -> [String] {
        guard let raw, !raw.isEmpty else { return [] }
        // 1) 先按 U+2063 拆分
        let primary = raw.components(separatedBy: tagSeparator)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        // 2) 对每个片段再按常见分隔符二次拆分，兼容历史/手工数据
        let commonSeparators = CharacterSet(charactersIn: ",，;；|、 ")
        let expanded: [String] = (primary.isEmpty ? [raw] : primary).flatMap { chunk in
            chunk.components(separatedBy: commonSeparators)
        }
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .map { $0.hasPrefix("#") ? String($0.dropFirst()) : $0 }
        .filter { !$0.isEmpty }

        // 3) 去重并保持顺序
        var seen: Set<String> = []
        var result: [String] = []
        for name in expanded {
            if !seen.contains(name) {
                result.append(name)
                seen.insert(name)
            }
        }
        return result
    }

    /// 将原始标签格式化为“每个标签+全角分号”的串，用于中文 UI 展示
    static func formatTagsWithSemicolon(_ raw: String?) -> String {
        let parts = parseTagsString(raw)
        return parts.map { "\($0)；" }.joined()
    }
}
