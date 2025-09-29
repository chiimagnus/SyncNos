import Foundation
import SQLite3

// MARK: - EPUB Context Service (MVP)
/// 基于 Apple Books 元数据与 EPUB CFI，从本地 .epub 提取高亮的上下文三段。
/// 约束：
/// - 仅适用于无 DRM 的 EPUB 文件。
/// - 依赖系统 /usr/bin/unzip 解压到临时目录（MVP，避免引入第三方库）。
/// - CFI 文件名解析采用简单策略：提取方括号内的文件名并在解压目录内匹配；
///   若失败则回退为基于选中文本在所有 xhtml/html 中模糊匹配。
final class EPUBContextService {
    private let logger = DIContainer.shared.loggerService

    // MARK: - Public API
    /// 为给定高亮提取上一段/当前段/下一段上下文。
    /// - Parameters:
    ///   - assetId: 书籍 ID（ZASSETID）
    ///   - highlight: 高亮行（需包含 selected text 与 location(epubcfi)）
    ///   - booksContainerHint: 可选的 Apple Books 容器路径（用户授权的文件夹）
    /// - Returns: HighlightContextTriplet，若无法解析则返回仅含 current 的降级结果
    func fetchContextTriplet(assetId: String, highlight: HighlightRow, booksDBPath: String? = nil, booksContainerHint: URL? = nil) -> HighlightContextTriplet? {
        guard let cfi = highlight.location, !cfi.isEmpty else {
            logger.warning("EPUBContextService: highlight missing CFI, return selected text only")
            return HighlightContextTriplet(previous: nil, current: highlight.text, next: nil)
        }
        logger.debug("EPUBContextService.fetchContextTriplet entry assetId=\(assetId) cfi=\(cfi) textPrefix=\(highlight.text.prefix(32))…")

        // 1) 解析书籍文件路径（优先 ZPATH）
        guard let bookFileURL = resolveBookFileURL(assetId: assetId, booksDBPath: booksDBPath, booksContainerHint: booksContainerHint) else {
            logger.warning("EPUBContextService: cannot resolve book path for assetId=\(assetId). Fallback to selected text only")
            return HighlightContextTriplet(previous: nil, current: highlight.text, next: nil)
        }
        logger.info("EPUBContextService: using book file \(bookFileURL.path)")

        // 2) 解压 EPUB 到临时目录
        guard let unzipDir = unzipEPUBIfNeeded(at: bookFileURL) else {
            logger.warning("EPUBContextService: unzip failed for \(bookFileURL.path). Fallback")
            return HighlightContextTriplet(previous: nil, current: highlight.text, next: nil)
        }
        defer { cleanup(dir: unzipDir) }
        logger.debug("EPUBContextService: unzip dir \(unzipDir.path)")

        // 3) 根据 CFI 找到目标章节文件
        let filenameFromCFI = parseFilenameFromCFI(cfi)
        logger.debug("EPUBContextService: filenameFromCFI=\(filenameFromCFI ?? "nil")")
        let chapterURL = locateChapterFile(root: unzipDir, preferredFilename: filenameFromCFI)
        logger.debug("EPUBContextService: chapterURL=\(chapterURL?.path ?? "nil")")

        // 4) 解析 HTML 并提取三段
        if let chapterURL = chapterURL,
           let triplet = extractTripletFromHTML(htmlURL: chapterURL, selectedText: highlight.text) {
            return triplet
        }

        // 5) 回退：全书扫描所有 html/xhtml，找到第一个包含选中文本的文件
        if let fallbackURL = findFirstHTMLContaining(root: unzipDir, substring: highlight.text),
           let triplet = extractTripletFromHTML(htmlURL: fallbackURL, selectedText: highlight.text) {
            logger.info("EPUBContextService: fallback matched at \(fallbackURL.path)")
            return triplet
        }

        logger.warning("EPUBContextService: failed to extract context, fallback to selected only")
        return HighlightContextTriplet(previous: nil, current: highlight.text, next: nil)
    }

    /// 便捷重载：供 UI 直接以文本 + CFI 调用（避免依赖 HighlightRow）。
    func fetchContextTriplet(assetId: String, selectedText: String, cfi: String?, booksDBPath: String? = nil, booksContainerHint: URL? = nil) -> HighlightContextTriplet? {
        guard let cfi = cfi, !cfi.isEmpty else {
            return HighlightContextTriplet(previous: nil, current: selectedText, next: nil)
        }
        logger.debug("EPUBContextService.fetchContextTriplet entry(assetId:selected:cfi) cfi=\(cfi) textPrefix=\(selectedText.prefix(32))…")
        guard let bookFileURL = resolveBookFileURL(assetId: assetId, booksDBPath: booksDBPath, booksContainerHint: booksContainerHint) else {
            logger.warning("EPUBContextService: cannot resolve book path for assetId=\(assetId). Fallback to selected text only")
            return HighlightContextTriplet(previous: nil, current: selectedText, next: nil)
        }
        logger.info("EPUBContextService: using book file \(bookFileURL.path)")
        guard let unzipDir = unzipEPUBIfNeeded(at: bookFileURL) else {
            logger.warning("EPUBContextService: unzip failed for \(bookFileURL.path). Fallback")
            return HighlightContextTriplet(previous: nil, current: selectedText, next: nil)
        }
        defer { cleanup(dir: unzipDir) }
        logger.debug("EPUBContextService: unzip dir \(unzipDir.path)")

        let filenameFromCFI = parseFilenameFromCFI(cfi)
        logger.debug("EPUBContextService: filenameFromCFI=\(filenameFromCFI ?? "nil")")
        let chapterURL = locateChapterFile(root: unzipDir, preferredFilename: filenameFromCFI)
        logger.debug("EPUBContextService: chapterURL=\(chapterURL?.path ?? "nil")")
        if let chapterURL = chapterURL,
           let triplet = extractTripletFromHTML(htmlURL: chapterURL, selectedText: selectedText) {
            return triplet
        }
        if let fallbackURL = findFirstHTMLContaining(root: unzipDir, substring: selectedText),
           let triplet = extractTripletFromHTML(htmlURL: fallbackURL, selectedText: selectedText) {
            logger.info("EPUBContextService: fallback matched at \(fallbackURL.path)")
            return triplet
        }
        return HighlightContextTriplet(previous: nil, current: selectedText, next: nil)
    }

    // MARK: - Resolve book file URL via BKLibrary
    private func resolveBookFileURL(assetId: String, booksDBPath: String?, booksContainerHint: URL?) -> URL? {
        // 优先从 BKLibrary 数据库获取 ZPATH
        if let zpath = queryBookZPATH(assetId: assetId, booksDBPath: booksDBPath, booksContainerHint: booksContainerHint) {
            let expanded = (zpath as NSString).expandingTildeInPath
            let fileURL = URL(fileURLWithPath: expanded)
            if FileManager.default.fileExists(atPath: fileURL.path) {
                logger.debug("EPUBContextService: BKLibrary.ZPATH exists \(fileURL.path)")
                return fileURL
            }
            logger.debug("EPUBContextService: BKLibrary.ZPATH not found on disk \(fileURL.path)")
        }
        // 回退：尝试本地 Books 容器（com.apple.BKAgentService）扫描匹配文件名（仅限同名 .epub）
        if let local = BookmarkStore.shared.restoreLocal() {
            _ = BookmarkStore.shared.startAccessing(url: local)
            let root = (local.path as NSString).appendingPathComponent("Data/Documents")
            if let guess = guessEPUBPath(assetId: assetId, under: root) {
                let url = URL(fileURLWithPath: guess)
                if FileManager.default.fileExists(atPath: url.path) {
                    logger.info("EPUBContextService: guessed local EPUB at \(url.path)")
                    return url
                }
            }
            logger.debug("EPUBContextService: no guessed EPUB under local container root=\(root)")
        }
        // 回退：尝试 iCloud Books 目录（若已授权）
        if let icloud = BookmarkStore.shared.restoreICloudBooks() {
            _ = BookmarkStore.shared.startAccessing(url: icloud)
            let root = icloud.path
            if let guess = guessEPUBPath(assetId: assetId, under: root) {
                let url = URL(fileURLWithPath: guess)
                if FileManager.default.fileExists(atPath: url.path) {
                    logger.info("EPUBContextService: guessed iCloud EPUB at \(url.path)")
                    return url
                }
            }
            logger.debug("EPUBContextService: no guessed EPUB under iCloud root=\(root)")
        }
        return nil
    }

    private func guessEPUBPath(assetId: String, under root: String) -> String? {
        // 仅在 BKLibrary 缺失路径时，按 assetId 前缀或任意 .epub 枚举尝试（MVP：返回第一个 .epub）
        guard let enumerator = FileManager.default.enumerator(atPath: root) else { return nil }
        for case let entry as String in enumerator {
            if entry.lowercased().hasSuffix(".epub") {
                return (root as NSString).appendingPathComponent(entry)
            }
        }
        return nil
    }

    private func queryBookZPATH(assetId: String, booksDBPath: String?, booksContainerHint: URL?) -> String? {
        // 使用传入的 booksDBPath；若未提供，则推断默认容器路径
        let bkLibraryPath: String
        if let provided = booksDBPath, !provided.isEmpty {
            bkLibraryPath = provided
        } else {
            let defaultContainer = booksContainerHint?.path ?? (NSHomeDirectory() + "/Library/Containers/com.apple.iBooksX")
            bkLibraryPath = defaultContainer + "/Data/Documents/BKLibrary/BKLibrary-1-091020131601.sqlite"
        }
        guard FileManager.default.fileExists(atPath: bkLibraryPath) else {
            logger.warning("EPUBContextService: BKLibrary DB not found at \(bkLibraryPath)")
            return nil
        }

        let connection = DatabaseConnectionService()
        var db: OpaquePointer?
        do {
            db = try connection.openReadOnlyDatabase(dbPath: bkLibraryPath)
        } catch {
            logger.error("EPUBContextService: open BKLibrary failed: \(error)")
            return nil
        }
        defer { connection.close(db) }

        let sql = "SELECT ZPATH FROM ZBKLIBRARYASSET WHERE ZASSETID=? LIMIT 1;"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }

        let ns = assetId as NSString
        sqlite3_bind_text(stmt, 1, ns.utf8String, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))

        var path: String?
        if sqlite3_step(stmt) == SQLITE_ROW {
            if let c0 = sqlite3_column_text(stmt, 0) {
                path = String(cString: c0)
            }
        }
        return path
    }

    // MARK: - Unzip
    private func unzipEPUBIfNeeded(at fileURL: URL) -> URL? {
        // 确保 iCloud 文件已本地可用
        if !self.ensureLocalAvailability(of: fileURL) {
            logger.warning("EPUBContextService: file not locally available \(fileURL.path)")
            return nil
        }

        // 在沙盒内创建工作目录，并先将源 epub 拷贝到沙盒再解压，避免安全作用域无法传递给子进程的问题
        let workRoot = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("SyncNosEPUB_" + UUID().uuidString, isDirectory: true)
        do { try FileManager.default.createDirectory(at: workRoot, withIntermediateDirectories: true) } catch {
            logger.error("EPUBContextService: create temp dir failed: \(error)")
            return nil
        }
        let localCopy = workRoot.appendingPathComponent("source.epub", isDirectory: false)
        do {
            // 优先使用字节复制，避免硬链接/跨卷失败
            let data = try Data(contentsOf: fileURL)
            try data.write(to: localCopy, options: .atomic)
            logger.debug("EPUBContextService: copied epub to \(localCopy.path)")
        } catch {
            logger.error("EPUBContextService: copy epub to temp failed: \(error)")
            return nil
        }

        // 使用系统 unzip 解压（-o 覆盖, -qq 安静模式）到 workRoot
        let process = Process()
        process.launchPath = "/usr/bin/unzip"
        process.arguments = ["-o", "-qq", localCopy.path, "-d", workRoot.path]
        let pipe = Pipe()
        process.standardError = pipe
        process.standardOutput = pipe
        do { try process.run() } catch {
            logger.error("EPUBContextService: failed to launch unzip: \(error)")
            return nil
        }
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let msg = String(data: data, encoding: .utf8) ?? ""
            logger.error("EPUBContextService: unzip exit=\(process.terminationStatus) msg=\(msg)")
            return nil
        }
        return workRoot
    }

    /// 确保给定 URL 对应文件在本地可访问（支持 iCloud 情况）
    private func ensureLocalAvailability(of url: URL) -> Bool {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        let exists = fm.fileExists(atPath: url.path, isDirectory: &isDir)
        if !exists || isDir.boolValue { return false }
        // iCloud 情况
        if fm.isUbiquitousItem(at: url) {
            do { try fm.startDownloadingUbiquitousItem(at: url) } catch {
                logger.warning("EPUBContextService: startDownloadingUbiquitousItem error=\(error.localizedDescription)")
            }
            let keys: Set<URLResourceKey> = [.ubiquitousItemDownloadingStatusKey]
            let deadline = Date().addingTimeInterval(10)
            while Date() < deadline {
                if let values = try? url.resourceValues(forKeys: keys) {
                    let status = values.ubiquitousItemDownloadingStatus ?? URLUbiquitousItemDownloadingStatus.notDownloaded
                    logger.debug("EPUBContextService: iCloud status=\(status.rawValue)")
                    if status == .current || status == .downloaded {
                        return true
                    }
                }
                Thread.sleep(forTimeInterval: 0.5)
            }
            return (try? url.checkResourceIsReachable()) ?? false
        }
        return true
    }

    private func cleanup(dir: URL) {
        try? FileManager.default.removeItem(at: dir)
    }

    // MARK: - Locate Chapter
    private func parseFilenameFromCFI(_ cfi: String) -> String? {
        // 支持多段 bracket，优先返回包含 .xhtml/.html/.htm 的段；否则返回 nil
        var results: [String] = []
        var startIdx = cfi.startIndex
        while let open = cfi[startIdx...].firstIndex(of: "[") {
            guard let close = cfi[open...].firstIndex(of: "]") else { break }
            let name = String(cfi[cfi.index(after: open)..<close])
            results.append(name)
            startIdx = cfi.index(after: close)
        }
        let lower = results.map { $0.lowercased() }
        if let idx = lower.firstIndex(where: { $0.hasSuffix(".xhtml") || $0.hasSuffix(".html") || $0.hasSuffix(".htm") }) {
            return results[idx]
        }
        return nil
    }

    private func locateChapterFile(root: URL, preferredFilename: String?) -> URL? {
        let fm = FileManager.default
        guard let enumerator = fm.enumerator(at: root, includingPropertiesForKeys: nil) else { return nil }
        var fallback: URL?
        for case let url as URL in enumerator {
            let lower = url.lastPathComponent.lowercased()
            if lower.hasSuffix(".xhtml") || lower.hasSuffix(".html") || lower.hasSuffix(".htm") {
                if let preferred = preferredFilename?.lowercased(), lower == preferred {
                    return url
                }
                if fallback == nil { fallback = url }
            }
        }
        return fallback
    }

    private func findFirstHTMLContaining(root: URL, substring: String) -> URL? {
        guard let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) else { return nil }
        let needle = normalize(substring)
        for case let url as URL in enumerator {
            let lower = url.lastPathComponent.lowercased()
            if lower.hasSuffix(".xhtml") || lower.hasSuffix(".html") || lower.hasSuffix(".htm") {
                if let data = try? Data(contentsOf: url), let content = String(data: data, encoding: .utf8) {
                    if normalize(content).contains(needle) {
                        return url
                    }
                }
            }
        }
        return nil
    }

    // MARK: - Extract Triplet
    private func extractTripletFromHTML(htmlURL: URL, selectedText: String) -> HighlightContextTriplet? {
        guard let data = try? Data(contentsOf: htmlURL),
              var html = String(data: data, encoding: .utf8) else {
            return nil
        }
        // 粗略移除样式与脚本，降低干扰
        html = stripTags(name: "script", in: html)
        html = stripTags(name: "style", in: html)

        // 提取段落（<p>...</p>），若没有 <p> 则按块级标记补充（如 <div>）
        let paragraphs = extractParagraphs(fromHTML: html)
        logger.debug("EPUBContextService: extracted paragraphs count=\(paragraphs.count)")
        if paragraphs.isEmpty { return nil }

        // 匹配含选中文本的段落（宽松匹配，忽略空白差异）
        let needle = normalize(selectedText)
        let normalizedParas = paragraphs.map { normalize($0) }
        guard let idx = normalizedParas.firstIndex(where: { $0.contains(needle) }) else {
            logger.debug("EPUBContextService: no paragraph contains selected text (len=\(selectedText.count))")
            // 回退：全文本范围里寻找最相近的段落（最长公共子串可选，MVP 不实现）
            return HighlightContextTriplet(previous: nil, current: selectedText, next: nil)
        }
        logger.debug("EPUBContextService: matched paragraph index=\(idx)")

        let current = trimmedForDisplay(paragraphs[idx])
        let previous = idx > 0 ? trimmedForDisplay(paragraphs[idx - 1]) : nil
        let next = idx + 1 < paragraphs.count ? trimmedForDisplay(paragraphs[idx + 1]) : nil
        return HighlightContextTriplet(previous: previous, current: current, next: next)
    }

    private func extractParagraphs(fromHTML html: String) -> [String] {
        // 优先 <p>，次选块级 <div>，最后按双换行拆分
        if let paras = firstMatchGroups(in: html, pattern: "(?is)<p[\\s\\S]*?>([\\s\\S]*?)</p>") , !paras.isEmpty { return paras }
        if let divs = firstMatchGroups(in: html, pattern: "(?is)<div[\\s\\S]*?>([\\s\\S]*?)</div>") , !divs.isEmpty { return divs }
        return html
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n\n")
    }

    // MARK: - Helpers
    private func normalize(_ s: String) -> String {
        // 去标签、实体与空白标准化（MVP 级别）
        var t = s
        t = t.replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: "&nbsp;", with: " ")
        t = t.replacingOccurrences(of: "&amp;", with: "&")
        t = t.replacingOccurrences(of: "&lt;", with: "<")
        t = t.replacingOccurrences(of: "&gt;", with: ">")
        // 把所有空白标准化为单空格
        let ws = CharacterSet.whitespacesAndNewlines
        let components = t.components(separatedBy: ws)
        t = components.filter { !$0.isEmpty }.joined(separator: " ")
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func trimmedForDisplay(_ s: String) -> String {
        let t = normalize(s)
        return t
    }

    private func firstMatchGroups(in text: String, pattern: String) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else { return nil }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        var results: [String] = []
        regex.enumerateMatches(in: text, options: [], range: range) { match, _, _ in
            if let match = match, match.numberOfRanges >= 2, let r = Range(match.range(at: 1), in: text) {
                results.append(String(text[r]))
            }
        }
        return results
    }

    private func stripTags(name: String, in html: String) -> String {
        // 构造如 (?is)<style\b[\s\S]*?</style> 的正则
        let safe = NSRegularExpression.escapedPattern(for: name)
        let pattern = "(?is)<" + safe + "\\b[\\s\\S]*?</" + safe + ">"
        return html.replacingOccurrences(of: pattern, with: "", options: .regularExpression)
    }
}


