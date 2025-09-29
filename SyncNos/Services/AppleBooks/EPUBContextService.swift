import Foundation
import SQLite3
import AppKit

struct HighlightContextTriple: Equatable {
    let previous: String?
    let current: String
    let next: String?
}

/// MVP：从 Books DB 的 ZPATH 定位本地 EPUB，解析 CFI 中章节文件名，读取该章节 HTML，
/// 将 HTML 转为纯文本后，用高亮文本匹配所在段落，再取前后段作为上下文。
/// 失败场景（无路径、DRM、找不到章节或匹配失败）直接返回 nil，由上层做降级显示。
final class EPUBContextService {
    private let logger = DIContainer.shared.loggerService

    // MARK: - Public API
    func loadContext(booksDBPath: String, assetId: String, cfi: String?, highlightText: String) -> HighlightContextTriple? {
        guard let epubPath = fetchBookPath(booksDBPath: booksDBPath, assetId: assetId) else {
            logger.warning("EPUBContextService: ZPATH not found for assetId=\(assetId)")
            return nil
        }
        let fileURL = URL(fileURLWithPath: epubPath)
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            logger.warning("EPUBContextService: EPUB not found at path=\(fileURL.path)")
            return nil
        }

        // 仅支持 .epub 的 MVP
        guard fileURL.pathExtension.lowercased() == "epub" else {
            logger.info("EPUBContextService: Non-EPUB book, skip context (path=\(fileURL.path))")
            return nil
        }

        // 从 CFI 提取章节文件名（如 [Chapter3.xhtml]）。若提取不到则失败。
        guard let cfi = cfi, let chapterName = extractChapterFileName(from: cfi) else {
            logger.warning("EPUBContextService: Chapter filename not found in CFI, assetId=\(assetId)")
            return nil
        }

        // 在 zip 中查找对应 entry（忽略目录），否则失败
        guard let entryPath = findEntryPath(inEPUB: fileURL.path, matchingFileName: chapterName) else {
            logger.warning("EPUBContextService: Chapter entry not found in EPUB, chapter=\(chapterName)")
            return nil
        }

        guard let htmlData = unzipReadFile(epubPath: fileURL.path, entryPath: entryPath) else {
            logger.error("EPUBContextService: Failed to read chapter content via unzip -p")
            return nil
        }

        guard let plainText = htmlToPlainText(htmlData) else {
            logger.error("EPUBContextService: Failed to convert HTML to plain text")
            return nil
        }

        return extractContext(in: plainText, for: highlightText)
    }

    // MARK: - DB: fetch ZPATH
    private func fetchBookPath(booksDBPath: String, assetId: String) -> String? {
        var db: OpaquePointer?
        let rc = sqlite3_open_v2(booksDBPath, &db, SQLITE_OPEN_READONLY, nil)
        guard rc == SQLITE_OK, let handle = db else { return nil }
        defer { sqlite3_close(handle) }

        let sql = "SELECT ZPATH FROM ZBKLIBRARYASSET WHERE ZASSETID=? LIMIT 1;"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }

        let ns = assetId as NSString
        sqlite3_bind_text(stmt, 1, ns.utf8String, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        if sqlite3_step(stmt) == SQLITE_ROW {
            if let c0 = sqlite3_column_text(stmt, 0) {
                return String(cString: c0)
            }
        }
        return nil
    }

    // MARK: - CFI helpers
    private func extractChapterFileName(from cfi: String) -> String? {
        // 形如 epubcfi(/6/20[Chapter3.xhtml]!/4/158/1,:137,:388)
        // 提取方括号内的文件名
        guard let left = cfi.firstIndex(of: "["), let right = cfi[left...].firstIndex(of: "]") else {
            return nil
        }
        let name = String(cfi[cfi.index(after: left)..<right])
        if name.isEmpty { return nil }
        return name
    }

    // MARK: - Zip helpers (MVP via /usr/bin/unzip)
    private func findEntryPath(inEPUB path: String, matchingFileName fileName: String) -> String? {
        guard let listing = unzipList(path: path) else { return nil }
        // 1) 直接按文件名匹配（大小写敏感与不敏感）
        if let viaName = matchListing(listing, fileName: fileName) { return viaName }

        // 2) 尝试 .html <-> .xhtml 扩展互换
        if fileName.lowercased().hasSuffix(".html") {
            let alt = String(fileName.dropLast(5)) + ".xhtml"
            if let viaAlt = matchListing(listing, fileName: alt) { return viaAlt }
        } else if fileName.lowercased().hasSuffix(".xhtml") {
            let alt = String(fileName.dropLast(6)) + ".html"
            if let viaAlt = matchListing(listing, fileName: alt) { return viaAlt }
        }

        // 3) 解析 OPF，使用 manifest 的 id/href 做映射（当 CFI 中的方括号不是文件名时）
        if let opfPath = findOpfPath(inEPUB: path),
           let (opfDir, manifest) = parseOpfManifest(epubPath: path, opfEntryPath: opfPath) {
            // 3.1 如果方括号是 manifest id
            if let href = manifest[fileName] {
                if let viaOpf = matchListing(listing, filePathRelativeToOpfDir: href, opfDir: opfDir) { return viaOpf }
            }
            // 3.2 按 href basename 或模糊包含匹配
            let targetBase = baseNameWithoutExt(fileName)
            // 先找 basename 完全相同
            if let href = manifest.values.first(where: { baseNameWithoutExt($0).caseInsensitiveCompare(targetBase) == .orderedSame }) {
                if let viaOpf = matchListing(listing, filePathRelativeToOpfDir: href, opfDir: opfDir) { return viaOpf }
            }
            // 再找 basename 包含关系
            if let href2 = manifest.values.first(where: { baseNameWithoutExt($0).lowercased().contains(targetBase.lowercased()) }) {
                if let viaOpf = matchListing(listing, filePathRelativeToOpfDir: href2, opfDir: opfDir) { return viaOpf }
            }
        }

        // 4) 退路：在 listing 中找 basename 匹配（忽略扩展）
        let targetBase = baseNameWithoutExt(fileName).lowercased()
        if let guess = listing.first(where: { baseNameWithoutExt($0).lowercased() == targetBase }) {
            return guess
        }
        if let guess2 = listing.first(where: { baseNameWithoutExt($0).lowercased().contains(targetBase) }) {
            return guess2
        }
        return nil
    }

    private func matchListing(_ listing: [String], fileName: String) -> String? {
        if let exact = listing.first(where: { $0.hasSuffix("/\(fileName)") || $0 == fileName }) { return exact }
        let lower = fileName.lowercased()
        return listing.first(where: { $0.lowercased().hasSuffix("/\(lower)") || $0.lowercased() == lower })
    }

    private func matchListing(_ listing: [String], filePathRelativeToOpfDir href: String, opfDir: String) -> String? {
        let normalized = normalizeZipPath("\(opfDir)/\(href)")
        // 直接匹配完整相对路径
        if let exact = listing.first(where: { normalizeZipPath($0).caseInsensitiveCompare(normalized) == .orderedSame }) { return exact }
        // 再退一步匹配结尾
        if let suffix = listing.first(where: { normalizeZipPath($0).lowercased().hasSuffix(normalized.lowercased()) }) { return suffix }
        return nil
    }

    private func normalizeZipPath(_ s: String) -> String {
        // 移除重复的 ./ 和 //，统一分隔符
        let replaced = s.replacingOccurrences(of: "\\\\", with: "/").replacingOccurrences(of: "//", with: "/")
        let parts = replaced.split(separator: "/").filter { $0 != "." }
        return parts.joined(separator: "/")
    }

    private func baseNameWithoutExt(_ path: String) -> String {
        let last = path.split(separator: "/").last.map(String.init) ?? path
        return (last as NSString).deletingPathExtension
    }

    private func unzipList(path: String) -> [String]? {
        let output = runProcess(launchPath: "/usr/bin/unzip", arguments: ["-Z1", path])
        guard let text = output, !text.isEmpty else { return nil }
        return text.split(separator: "\n").map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    private func unzipReadFile(epubPath: String, entryPath: String) -> Data? {
        guard let output = runProcess(launchPath: "/usr/bin/unzip", arguments: ["-p", epubPath, entryPath]) else { return nil }
        return output.data(using: .utf8)
    }

    private func runProcess(launchPath: String, arguments: [String]) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: launchPath)
        process.arguments = arguments

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()

        do {
            try process.run()
        } catch {
            logger.error("EPUBContextService: Failed to run process \(launchPath) \(arguments) error=\(error)")
            return nil
        }
        process.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8)
    }

    // MARK: - OPF helpers
    private func findOpfPath(inEPUB path: String) -> String? {
        // META-INF/container.xml 中的 rootfile/@full-path 给出 OPF 路径
        guard let containerXML = runProcess(launchPath: "/usr/bin/unzip", arguments: ["-p", path, "META-INF/container.xml"]) else { return nil }
        // 使用正则提取 full-path（更稳健）
        let pattern = #"full-path="([^"]+)"#
        if let regex = try? NSRegularExpression(pattern: pattern, options: []) {
            let ns = containerXML as NSString
            if let m = regex.firstMatch(in: containerXML, options: [], range: NSRange(location: 0, length: ns.length)), m.numberOfRanges >= 2 {
                let full = ns.substring(with: m.range(at: 1))
                return full
            }
        }
        return nil
    }

    private func parseOpfManifest(epubPath: String, opfEntryPath: String) -> (opfDir: String, manifest: [String: String])? {
        guard let opfXML = runProcess(launchPath: "/usr/bin/unzip", arguments: ["-p", epubPath, opfEntryPath]) else { return nil }
        // 解析 <item id="..." href="..." ... />，构建 id->href 映射
        var mapping: [String: String] = [:]
        let pattern = "<item\\s+[^>]*id=\\\"([^\\\"]+)\\\"[^>]*href=\\\"([^\\\"]+)\\\"[^>]*/?>"
        if let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) {
            let ns = opfXML as NSString
            let matches = regex.matches(in: opfXML, options: [], range: NSRange(location: 0, length: ns.length))
            for m in matches {
                if m.numberOfRanges >= 3 {
                    let id = ns.substring(with: m.range(at: 1))
                    let href = ns.substring(with: m.range(at: 2))
                    mapping[id] = href
                }
            }
        }
        let opfDir = (opfEntryPath as NSString).deletingLastPathComponent
        return (opfDir: opfDir, manifest: mapping)
    }

    // MARK: - HTML -> Plain
    private func htmlToPlainText(_ data: Data) -> String? {
        // 使用 NSAttributedString 将 HTML 转为纯文本，保留段落换行
        if let attributed = try? NSAttributedString(
            data: data,
            options: [
                .documentType: NSAttributedString.DocumentType.html,
                .characterEncoding: String.Encoding.utf8.rawValue
            ],
            documentAttributes: nil
        ) {
            return attributed.string
        }
        // 回退：粗糙去标签
        if let html = String(data: data, encoding: .utf8) {
            let replaced = html.replacingOccurrences(of: "</p>", with: "\n\n")
            return replaced.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        }
        return nil
    }

    // MARK: - Context extraction
    private func extractContext(in text: String, for snippet: String) -> HighlightContextTriple? {
        guard !snippet.isEmpty else { return nil }
        // 宽松匹配：去除多余空白
        let normalizedText = text.replacingOccurrences(of: "\r", with: "")
        let normalizedSnippet = snippet.trimmingCharacters(in: .whitespacesAndNewlines)

        guard normalizedText.range(of: normalizedSnippet) != nil else {
            return nil
        }

        // 按双换行视作段落边界
        let full = normalizedText as NSString
        let location = full.range(of: normalizedSnippet).location

        let prevBoundary = (full.substring(to: location) as NSString).range(of: "\n\n", options: [.backwards]).location
        let startIndex = prevBoundary != NSNotFound ? prevBoundary + 2 : 0

        let afterIndex = location + (normalizedSnippet as NSString).length
        let tail = full.substring(from: afterIndex) as NSString
        let nextBoundaryLocal = tail.range(of: "\n\n").location
        let endIndex = nextBoundaryLocal != NSNotFound ? afterIndex + nextBoundaryLocal : full.length

        let current = full.substring(with: NSRange(location: startIndex, length: max(0, endIndex - startIndex))).trimmingCharacters(in: .whitespacesAndNewlines)

        // 上一段
        var previous: String? = nil
        if startIndex > 0 {
            let head = full.substring(to: startIndex - 2) as NSString // 去掉前面的分隔符
            let prevPrevBoundary = head.range(of: "\n\n", options: [.backwards]).location
            let pStart = prevPrevBoundary != NSNotFound ? prevPrevBoundary + 2 : 0
            previous = head.substring(from: pStart).trimmingCharacters(in: .whitespacesAndNewlines)
            if previous?.isEmpty == true { previous = nil }
        }

        // 下一段
        var next: String? = nil
        if endIndex < full.length {
            let rest = full.substring(from: endIndex + 2) as NSString // 跳过分隔符
            let nextNextBoundary = rest.range(of: "\n\n").location
            let nEnd = nextNextBoundary != NSNotFound ? nextNextBoundary : rest.length
            next = rest.substring(to: nEnd).trimmingCharacters(in: .whitespacesAndNewlines)
            if next?.isEmpty == true { next = nil }
        }

        let safeCurrent = current.isEmpty ? normalizedSnippet : current
        return HighlightContextTriple(previous: previous, current: safeCurrent, next: next)
    }
}


