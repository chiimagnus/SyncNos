import Foundation

/// Apple Books 位置解析器：根据 Apple Books 的跳转片段/数据库位置字符串，
/// 尝试生成更易读的章节/页码/位置描述。
/// 说明：Apple Books 的 `ZANNOTATIONLOCATION` 在不同书籍/版本中格式不统一，
/// 常见格式包括：
/// - "loc=12345"：以 location 数字表示阅读位置
/// - "page=12"：页码
/// - "epubcfi(/6/8[htm|44]!/4/302/1,:53,:74)"：EPUB CFI 标准路径
/// - 纯数字字符串，如 "12345"
/// 本解析器采用启发式策略，无法保证完全准确映射到书内目录结构，但能提供稳定可读的标注。
struct AppleBooksLocationParser {
    struct ParsedLocation {
        let chapterIndexApprox: Int?
        let sectionIndexApprox: Int?
        let pageNumber: Int?
        let locationNumber: Int?
        let raw: String
    }

    static func parse(_ location: String?) -> ParsedLocation? {
        guard let location, !location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let s = location.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = s.lowercased()

        // page=
        if lower.hasPrefix("page=") {
            if let v = Int(s.dropFirst(5)) {
                return ParsedLocation(chapterIndexApprox: nil, sectionIndexApprox: nil, pageNumber: v, locationNumber: nil, raw: s)
            }
        }

        // loc=
        if lower.hasPrefix("loc=") {
            if let v = Int(s.dropFirst(4)) {
                return ParsedLocation(chapterIndexApprox: nil, sectionIndexApprox: nil, pageNumber: nil, locationNumber: v, raw: s)
            }
        }

        // 纯数字
        if let v = Int(s) {
            return ParsedLocation(chapterIndexApprox: nil, sectionIndexApprox: nil, pageNumber: nil, locationNumber: v, raw: s)
        }

        // epubcfi(...) - 解析 percent-encoded 的 EPUB CFI
        if lower.hasPrefix("epubcfi(") || lower.hasPrefix("epubcfi（") {
            return parseEPUBCFI(s)
        }

        // 未知格式，直接返回原始字符串作为 raw
        return ParsedLocation(chapterIndexApprox: nil, sectionIndexApprox: nil, pageNumber: nil, locationNumber: nil, raw: s)
    }

    /// 生成最终展示文案（中文）：优先显示章/节，其次展示页码或位置，兜底显示原始字符串
    static func displayString(from location: String?) -> String? {
        guard let parsed = parse(location) else { return nil }
        if let page = parsed.pageNumber {
            return "第 \(page) 页"
        }
        if parsed.chapterIndexApprox != nil || parsed.sectionIndexApprox != nil {
            let ch = parsed.chapterIndexApprox.map { "第\($0)章" } ?? ""
            let sec = parsed.sectionIndexApprox.map { " 第\($0)节" } ?? ""
            if let pos = parsed.locationNumber {
                return "\(ch)\(sec) 位置\(pos)".trimmingCharacters(in: .whitespaces)
            } else {
                return "\(ch)\(sec)".trimmingCharacters(in: .whitespaces)
            }
        }
        if let loc = parsed.locationNumber {
            return "位置 \(loc)"
        }
        return nil // 不显示原始字符串，避免混乱
    }

    // MARK: - EPUB CFI Parsing

    /// 解析 EPUB CFI 格式的位置字符串
    /// 示例：epubcfi(/6/8[htm|44]!/4/302/1,:53,:74)
    /// 或 URL encoded: epubcfi(/6/8%5Bhtm|44%5D!/4/302/1,:53,:74)
    private static func parseEPUBCFI(_ s: String) -> ParsedLocation {
        // 移除 "epubcfi(" 前缀和 ")" 后缀，支持中英文括号
        var inner = s
        if let openParen = inner.firstIndex(where: { $0 == "(" || $0 == "（" }) {
            inner = String(inner[inner.index(after: openParen)...])
        }
        if let closeParen = inner.lastIndex(where: { $0 == ")" || $0 == "）" }) {
            inner = String(inner[..<closeParen])
        }

        // URL decode: %5B -> [, %5D -> ], 等等
        if let decoded = inner.removingPercentEncoding {
            inner = decoded
        }

        // 拆分为 spine path 和 content 复合段 (用 "!" 分隔)
        let bangSplit = inner.split(separator: "!", maxSplits: 1, omittingEmptySubsequences: false)
        let spinePath = bangSplit.first.map(String.init) ?? ""
        let contentCompound = bangSplit.count > 1 ? String(bangSplit[1]) : ""

        // content 再按逗号切分：第一个是节点路径，其余为偏移
        let commaSplit = contentCompound.split(separator: ",", omittingEmptySubsequences: true).map(String.init)
        let contentNodePath = commaSplit.first ?? ""
        let contentOffsets = Array(commaSplit.dropFirst())

        // 提取数字序列
        let spineNumbersAll = extractNumbers(from: spinePath)
        let contentNodeNumsAll = extractNumbers(from: contentNodePath)
        let spineEven = spineNumbersAll.filter { $0 % 2 == 0 }
        let contentEven = contentNodeNumsAll.filter { $0 % 2 == 0 }

        // 章：优先 spine 的第一个偶数/2；没有则用最后一个偶数/2
        let chapterApprox: Int? = {
            if let first = spineEven.first { return max(1, first / 2) }
            if let last = spineEven.last { return max(1, last / 2) }
            return nil
        }()

        // 节：使用 content 节点路径的最后一个偶数/2（同章内差异更明显）
        let sectionApprox: Int? = {
            if let last = contentEven.last { return max(1, last / 2) }
            if let first = contentEven.first { return max(1, first / 2) }
            return nil
        }()

        // 位置：优先逗号后偏移的第一个数字；否则用 content 节点路径中的最大数字
        let offsetNums = contentOffsets.flatMap { extractNumbers(from: $0) }
        let locationApprox: Int? = offsetNums.first ?? contentNodeNumsAll.max()

        return ParsedLocation(
            chapterIndexApprox: chapterApprox,
            sectionIndexApprox: sectionApprox,
            pageNumber: nil,
            locationNumber: locationApprox,
            raw: s
        )
    }

    /// 从字符串中提取所有正整数
    /// 忽略方括号、竖线、逗号、冒号等分隔符
    private static func extractNumbers(from path: String) -> [Int] {
        if path.isEmpty { return [] }
        var numbers: [Int] = []
        var currentDigits: [Character] = []
        
        func flush() {
            if !currentDigits.isEmpty, let v = Int(String(currentDigits)), v > 0 {
                numbers.append(v)
            }
            currentDigits.removeAll(keepingCapacity: true)
        }
        
        for ch in path {
            if ch >= "0" && ch <= "9" {
                currentDigits.append(ch)
            } else {
                flush()
            }
        }
        flush()
        
        return numbers
    }
}
