import Foundation

final class NotionService: NotionServiceProtocol {
    private let configStore: NotionConfigStoreProtocol
    private let logger = DIContainer.shared.loggerService
    private let apiBase = URL(string: "https://api.notion.com/v1/")!
    private let notionVersion = "2022-06-28"
    // ISO8601 formatter for highlight timestamps when syncing to Notion
    private static let isoDateFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    
    init(configStore: NotionConfigStoreProtocol) {
        self.configStore = configStore
    }
    // Lightweight exists check by querying minimal page
    func databaseExists(databaseId: String) async -> Bool {
        // Keep behavior: return false when not configured or any non-2xx / error occurs
        guard configStore.notionKey != nil else { return false }
        struct DatabaseMeta: Decodable { let id: String; let in_trash: Bool? }
        do {
            let data = try await performRequest(path: "databases/\(databaseId)", method: "GET", body: nil)
            if let meta = try? JSONDecoder().decode(DatabaseMeta.self, from: data), (meta.in_trash ?? false) {
                return false
            }
            // Some trashed databases still return 200 on GET; verify by running a minimal query
            _ = try await performRequest(path: "databases/\(databaseId)/query", method: "POST", body: ["page_size": 1])
            return true
        } catch {
            return false
        }
    }

    func createDatabase(title: String) async throws -> NotionDatabase {
        guard let pageId = configStore.notionPageId, let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        
        let body: [String: Any] = [
            "parent": [
                "type": "page_id",
                "page_id": pageId
            ],
            "title": [[
                "type": "text",
                "text": ["content": title]
            ]],
            "properties": [
                // Primary title property (book title)
                "Name": ["title": [:]],
                // Author as rich text
                "Author": ["rich_text": [:]],
                // Highlight count as number
                "Highlight Count": ["number": [:]],
                // Asset ID for idempotent lookup
                "Asset ID": ["rich_text": [:]],
                // Book URL
                "URL": ["url": [:]],
                // Extended properties for GoodLinks
                "Tags": ["multi_select": [:]],
                "Summary": ["rich_text": [:]],
                "Starred": ["checkbox": [:]],
                "Added At": ["date": [:]],
                "Modified At": ["date": [:]]
            ]
        ]
        let data = try await performRequest(path: "databases", method: "POST", body: body)
        return try JSONDecoder().decode(NotionDatabase.self, from: data)
    }
    
    
    // MARK: - Extended helpers for sync
    struct SearchResponse: Decodable {
        struct Parent: Decodable { let type: String?; let page_id: String?; let database_id: String? }
        struct Title: Decodable { let plain_text: String? }
        struct Result: Decodable {
            let id: String
            let object: String
            let parent: Parent?
            let title: [Title]?
        }
        let results: [Result]
        let has_more: Bool?
        let next_cursor: String?
    }
    
    func findDatabaseId(title: String, parentPageId: String) async throws -> String? {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        
        let body: [String: Any] = [
            "query": title,
            "filter": ["value": "database", "property": "object"],
            "sort": ["direction": "ascending", "timestamp": "last_edited_time"]
        ]
        let data = try await performRequest(path: "search", method: "POST", body: body)
        let decoded = try JSONDecoder().decode(SearchResponse.self, from: data)
        for r in decoded.results where r.object == "database" {
            let t = (r.title ?? []).compactMap { $0.plain_text }.joined()
            if t.caseInsensitiveCompare(title) == .orderedSame, r.parent?.page_id == parentPageId {
                return r.id
            }
        }
        return nil
    }
    
    struct QueryResponse: Decodable {
        struct Page: Decodable { let id: String }
        let results: [Page]
        let has_more: Bool?
        let next_cursor: String?
    }
    
    func findPageIdByAssetId(databaseId: String, assetId: String) async throws -> String? {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        let body: [String: Any] = [
            "filter": [
                "property": "Asset ID",
                "rich_text": ["equals": assetId]
            ],
            "page_size": 1
        ]
        let data = try await performRequest(path: "databases/\(databaseId)/query", method: "POST", body: body)
        let decoded = try JSONDecoder().decode(QueryResponse.self, from: data)
        return decoded.results.first?.id
    }
    
    func createBookPage(databaseId: String, bookTitle: String, author: String, assetId: String, urlString: String?, header: String?) async throws -> NotionPage {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        var properties: [String: Any] = [
            "Name": [
                "title": [["text": ["content": bookTitle]]]
            ],
            "Asset ID": [
                "rich_text": [["text": ["content": assetId]]]
            ],
            "Author": [
                "rich_text": [["text": ["content": author]]]
            ]
        ]
        if let urlString = urlString, !urlString.isEmpty {
            properties["URL"] = ["url": urlString]
        }
        var children: [[String: Any]] = []
        if let header = header, !header.isEmpty {
            children = [[
                "object": "block",
                "heading_2": [
                    "rich_text": [["text": ["content": header]]]
                ]
            ]]
        }
        // Initial structure: Article (empty) + Highlights header
        children.append([
            "object": "block",
            "heading_2": [
                "rich_text": [["text": ["content": "Article"]]]
            ]
        ])
        // Placeholder empty paragraph; actual content will replace page children later
        children.append([
            "object": "block",
            "paragraph": [
                "rich_text": []
            ]
        ])
        children.append([
            "object": "block",
            "heading_2": [
                "rich_text": [["text": ["content": "Highlights"]]]
            ]
        ])
        let body: [String: Any] = [
            "parent": ["type": "database_id", "database_id": databaseId],
            "properties": properties,
            "children": children
        ]
        let data = try await performRequest(path: "pages", method: "POST", body: body)
        return try JSONDecoder().decode(NotionPage.self, from: data)
    }
    
    struct BlockChildrenResponse: Decodable {
        struct RichText: Decodable { let plain_text: String? }
        struct RichTextHolder: Decodable { let rich_text: [RichText]? }
        struct Block: Decodable {
            let id: String
            let type: String
            let paragraph: RichTextHolder?
            let bulleted_list_item: RichTextHolder?
        }
        let results: [Block]
        let has_more: Bool
        let next_cursor: String?
    }

        
    func collectExistingUUIDs(fromPageId pageId: String) async throws -> Set<String> {
        let mapping = try await collectExistingUUIDToBlockIdMapping(fromPageId: pageId)
        return Set(mapping.keys)
    }

    func collectExistingUUIDToBlockIdMapping(fromPageId pageId: String) async throws -> [String: String] {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        var collected: [String: String] = [:]
        var startCursor: String? = nil
        repeat {
            var components = URLComponents(url: apiBase.appendingPathComponent("blocks/\(pageId)/children"), resolvingAgainstBaseURL: false)!
            if let cursor = startCursor {
                components.queryItems = [URLQueryItem(name: "start_cursor", value: cursor)]
            }
            let data = try await performRequest(url: components.url!, method: "GET", body: nil)
            let decoded = try JSONDecoder().decode(BlockChildrenResponse.self, from: data)
            for block in decoded.results {
                let holder = block.paragraph ?? block.bulleted_list_item
                let texts = holder?.rich_text ?? []
                for t in texts {
                    if let s = t.plain_text {
                        logger.verbose("DEBUG: 检查文本内容: \(s)")
                        // 查找 "[uuid:" 和 "]" 之间的内容
                        if let startRange = s.range(of: "[uuid:") {
                            let startIdx = startRange.upperBound // 跳过 "[uuid:"
                            if let endRange = s.range(of: "]", range: startIdx..<s.endIndex) {
                                let idPart = String(s[startIdx..<endRange.lowerBound])
                                collected[idPart] = block.id
                                logger.debug("DEBUG: 找到UUID映射 - UUID: \(idPart), Block ID: \(block.id)")
                            } else {
                                logger.debug("DEBUG: 未找到结束括号]")
                            }
                        }
                    }
                }
            }
            startCursor = decoded.has_more ? decoded.next_cursor : nil
        } while startCursor != nil
        logger.debug("DEBUG: 收集到 \(collected.count) 个UUID到块ID的映射")
        return collected
    }
    
    func appendHighlightBullets(pageId: String, bookId: String, highlights: [HighlightRow]) async throws {
        // 上层会批次调用此函数。这里实现安全的分片/降级递归，遇到单条失败尝试内容裁剪；仍失败则跳过该条，保证后续条目不被拖累。
        func buildBlock(for h: HighlightRow) -> [String: Any] {
            let rt = buildHighlightRichText(for: h, bookId: bookId, maxTextLength: 1800)
            return [
                "object": "block",
                "bulleted_list_item": ["rich_text": rt]
            ]
        }

        func appendSlice(_ slice: ArraySlice<HighlightRow>) async throws {
            let children = slice.map { buildBlock(for: $0) }
            do {
                try await appendBlocks(pageId: pageId, children: children)
            } catch {
                // 如果一批失败，且数量>1，切半递归重试；数量==1 时尝试更激进的裁剪（再次失败则跳过）
                if slice.count > 1 {
                    let mid = slice.startIndex + slice.count / 2
                    try await appendSlice(slice[slice.startIndex..<mid])
                    try await appendSlice(slice[mid..<slice.endIndex])
                } else if let h = slice.first {
                    // 单条仍失败：进一步强裁剪文本到 1000
                    let rt = buildHighlightRichText(for: h, bookId: bookId, maxTextLength: 1000)
                    let child: [[String: Any]] = [[
                        "object": "block",
                        "bulleted_list_item": ["rich_text": rt]
                    ]]
                    do {
                        try await appendBlocks(pageId: pageId, children: child)
                    } catch {
                        // 彻底放弃该条，记录并跳过，避免整本失败
                        logger.warning("Skip one highlight due to Notion API error: uuid=\(h.uuid) message=\(error.localizedDescription)")
                    }
                }
            }
        }

        // 入口：按 80 一批，逐批递归发送
        let batchSize = 80
        var index = 0
        while index < highlights.count {
            let slice = highlights[index..<min(index + batchSize, highlights.count)]
            try await appendSlice(slice)
            index += batchSize
        }
    }

    func appendBlocks(pageId: String, children: [[String: Any]]) async throws {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        let url = apiBase.appendingPathComponent("blocks/\(pageId)/children")
        let _ = try await performRequest(path: "blocks/\(pageId)/children", method: "PATCH", body: ["children": children])
    }
    
    func updatePageHighlightCount(pageId: String, count: Int) async throws {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        let _ = try await performRequest(path: "pages/\(pageId)", method: "PATCH", body: ["properties": ["Highlight Count": ["number": count]]])
    }

    // MARK: - Generic property/schema helpers
    func ensureDatabaseProperties(databaseId: String, definitions: [String: Any]) async throws {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        let _ = try await performRequest(path: "databases/\(databaseId)", method: "PATCH", body: ["properties": definitions])
    }

    func updatePageProperties(pageId: String, properties: [String: Any]) async throws {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        let _ = try await performRequest(path: "pages/\(pageId)", method: "PATCH", body: ["properties": properties])
    }

    func updateBlockContent(blockId: String, highlight: HighlightRow, bookId: String) async throws {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }

        // 构建富文本内容
        let rt = buildHighlightRichText(for: highlight, bookId: bookId)
        let _ = try await performRequest(path: "blocks/\(blockId)", method: "PATCH", body: ["bulleted_list_item": ["rich_text": rt]])
    }

    // MARK: - Per-book database (方案2)
    func createPerBookHighlightDatabase(bookTitle: String, author: String, assetId: String) async throws -> NotionDatabase {
        guard let pageId = configStore.notionPageId, let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }

        // Database title uses book title for clarity
        let dbTitle = "SyncNos - \(bookTitle)"

        // Properties for highlight items（Style 采用 rich_text 以承载 “{颜色名}_{数字}” 文本）
        let body: [String: Any] = [
            "parent": [
                "type": "page_id",
                "page_id": pageId
            ],
            "title": [[
                "type": "text",
                "text": ["content": dbTitle]
            ]],
            "properties": [
                // Title property for highlight text
                "Text": ["title": [:]],
                // Metadata
                "UUID": ["rich_text": [:]],
                "Note": ["rich_text": [:]],
                "Style": ["rich_text": [:]],
                "Added At": ["date": [:]],
                "Modified At": ["date": [:]],
                "Location": ["rich_text": [:]],
                // Book info for redundancy and filtering
                "Book ID": ["rich_text": [:]],
                "Book Title": ["rich_text": [:]],
                "Author": ["rich_text": [:]],
                "Link": ["url": [:]]
            ]
        ]
        let data = try await performRequest(path: "databases", method: "POST", body: body)
        return try JSONDecoder().decode(NotionDatabase.self, from: data)
    }

    func createHighlightItem(inDatabaseId databaseId: String, bookId: String, bookTitle: String, author: String, highlight: HighlightRow) async throws -> NotionPage {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }

        let properties = buildHighlightProperties(bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight)
        let children = buildHighlightChildren(bookId: bookId, highlight: highlight)

        let body: [String: Any] = [
            "parent": [
                "type": "database_id",
                "database_id": databaseId
            ],
            "properties": properties,
            "children": children
        ]
        let data = try await performRequest(path: "pages", method: "POST", body: body)
        return try JSONDecoder().decode(NotionPage.self, from: data)
    }

    func findHighlightItemPageIdByUUID(databaseId: String, uuid: String) async throws -> String? {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        let body: [String: Any] = [
            "filter": [
                "property": "UUID",
                "rich_text": ["equals": uuid]
            ],
            "page_size": 1
        ]
        let data = try await performRequest(path: "databases/\(databaseId)/query", method: "POST", body: body)
        let decoded = try JSONDecoder().decode(QueryResponse.self, from: data)
        return decoded.results.first?.id
    }

    func updateHighlightItem(pageId: String, bookId: String, bookTitle: String, author: String, highlight: HighlightRow) async throws {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }

        let properties = buildHighlightProperties(bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight, clearEmpty: true)
        let _ = try await performRequest(path: "pages/\(pageId)", method: "PATCH", body: ["properties": properties])

        // Replace page children with up-to-date content
        let children = buildHighlightChildren(bookId: bookId, highlight: highlight)
        try await replacePageChildren(pageId: pageId, with: children)
    }

    // MARK: - Helpers for per-book item content
    private func buildHighlightChildren(bookId: String, highlight: HighlightRow) -> [[String: Any]] {
        var children: [[String: Any]] = []
        // 1) Quote block for highlight text
        children.append([
            "object": "block",
            "quote": [
                "rich_text": [["text": ["content": highlight.text]]]
            ]
        ])
        // 2) Note block if exists
        if let note = highlight.note, !note.isEmpty {
            children.append([
                "object": "block",
                "paragraph": [
                    "rich_text": [[
                        "text": ["content": note],
                        "annotations": ["italic": true]
                    ]]
                ]
            ])
        }
        // 3) Metadata line (style/added/modified)
        let metaString = buildMetadataString(for: highlight)
        if !metaString.isEmpty {
            children.append([
                "object": "block",
                "paragraph": [
                    "rich_text": [[
                        "text": ["content": metaString],
                        "annotations": ["italic": true]
                    ]]
                ]
            ])
        }
        // 4) Open in Apple Books link
        let linkUrl = buildIBooksLink(bookId: bookId, location: highlight.location)
        children.append([
            "object": "block",
            "paragraph": [
                "rich_text": [[
                    "text": ["content": "Open ↗"],
                    "href": linkUrl
                ]]
            ]
        ])
        return children
    }

    private func replacePageChildren(pageId: String, with children: [[String: Any]]) async throws {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        // 1) List existing children
        var startCursor: String? = nil
        var existing: [BlockChildrenResponse.Block] = []
        repeat {
            var components = URLComponents(url: apiBase.appendingPathComponent("blocks/\(pageId)/children"), resolvingAgainstBaseURL: false)!
            if let cursor = startCursor {
                components.queryItems = [URLQueryItem(name: "start_cursor", value: cursor)]
            }
            let data = try await performRequest(url: components.url!, method: "GET", body: nil)
            let decoded = try JSONDecoder().decode(BlockChildrenResponse.self, from: data)
            existing.append(contentsOf: decoded.results)
            startCursor = decoded.has_more ? decoded.next_cursor : nil
        } while startCursor != nil

        // 2) Delete existing children
        for block in existing {
            let delURL = apiBase.appendingPathComponent("blocks/\(block.id)")
            // Best-effort delete: ignore failures
            _ = try? await performRequest(url: delURL, method: "DELETE", body: nil)
        }

        // 3) Append new children
        try await appendBlocks(pageId: pageId, children: children)
    }

    // Expose as protocol method
    func setPageChildren(pageId: String, children: [[String: Any]]) async throws {
        try await replacePageChildren(pageId: pageId, with: children)
    }

    // MARK: - Shared helper methods

    // Build iBooks link URL
    private func buildIBooksLink(bookId: String, location: String?) -> String {
        if let loc = location, !loc.isEmpty {
            return "ibooks://assetid/\(bookId)#\(loc)"
        } else {
            return "ibooks://assetid/\(bookId)"
        }
    }

    // Build metadata string from highlight
    private func buildMetadataString(for highlight: HighlightRow) -> String {
        var metaParts: [String] = []
        if let s = highlight.style { metaParts.append("style:\(s)") }
        if let d = highlight.dateAdded { metaParts.append("added:\(Self.isoDateFormatter.string(from: d))") }
        if let m = highlight.modified { metaParts.append("modified:\(Self.isoDateFormatter.string(from: m))") }
        return metaParts.joined(separator: " | ")
    }

    // Build highlight properties for per-book database
    private func buildHighlightProperties(bookId: String, bookTitle: String, author: String, highlight: HighlightRow, clearEmpty: Bool = false) -> [String: Any] {
        var properties: [String: Any] = [
            "Text": [
                "title": [["text": ["content": highlight.text]]]
            ],
            "UUID": [
                "rich_text": [["text": ["content": highlight.uuid]]]
            ],
            "Book ID": [
                "rich_text": [["text": ["content": bookId]]]
            ],
            "Book Title": [
                "rich_text": [["text": ["content": bookTitle]]]
            ],
            "Author": [
                "rich_text": [["text": ["content": author]]]
            ]
        ]

        if let note = highlight.note, !note.isEmpty {
            properties["Note"] = ["rich_text": [["text": ["content": note]]]]
        } else if clearEmpty {
            properties["Note"] = ["rich_text": []]
        }

        if let style = highlight.style {
            properties["Style"] = [
                "rich_text": [["text": ["content": styleName(for: style) + "_\(style)"]]]
            ]
        } else if clearEmpty {
            properties["Style"] = ["rich_text": []]
        }

        if let added = highlight.dateAdded {
            properties["Added At"] = [
                "date": [
                    "start": Self.isoDateFormatter.string(from: added)
                ]
            ]
        }

        if let modified = highlight.modified {
            properties["Modified At"] = [
                "date": [
                    "start": Self.isoDateFormatter.string(from: modified)
                ]
            ]
        }

        if let loc = highlight.location, !loc.isEmpty {
            properties["Location"] = ["rich_text": [["text": ["content": loc]]]]
        } else if clearEmpty {
            properties["Location"] = ["rich_text": []]
        }

        let linkUrl = buildIBooksLink(bookId: bookId, location: highlight.location)
        properties["Link"] = ["url": linkUrl]

        return properties
    }

    // Build rich text for highlight bullet/list item
    private func buildHighlightRichText(for highlight: HighlightRow, bookId: String, maxTextLength: Int? = nil) -> [[String: Any]] {
        var rt: [[String: Any]] = []

        // Highlight text with optional length limit
        let textContent = maxTextLength != nil && highlight.text.count > maxTextLength!
            ? String(highlight.text.prefix(maxTextLength!))
            : highlight.text
        rt.append(["text": ["content": textContent]])

        // Optional note with length limit
        if let note = highlight.note, !note.isEmpty {
            let noteContent = maxTextLength != nil && note.count > maxTextLength!
                ? String(note.prefix(maxTextLength!))
                : note
            rt.append(["text": ["content": " — Note: \(noteContent)"], "annotations": ["italic": true]])
        }

        // Add metadata when available
        let metaString = buildMetadataString(for: highlight)
        if !metaString.isEmpty {
            rt.append(["text": ["content": " — \(metaString)"], "annotations": ["italic": true]])
        }

        // Link to open in Apple Books
        let linkUrl = buildIBooksLink(bookId: bookId, location: highlight.location)
        rt.append(["text": ["content": "  Open ↗"], "href": linkUrl])

        // UUID marker for idempotency
        rt.append(["text": ["content": " [uuid:\(highlight.uuid)]"], "annotations": ["code": true]])

        return rt
    }

    // Convert numeric style to human-friendly color name
    private func styleName(for style: Int) -> String {
        switch style {
        case 0: return "orange"
        case 1: return "green"
        case 2: return "blue"
        case 3: return "yellow"
        case 4: return "pink"
        case 5: return "purple"
        default: return "gray"
        }
    }
    
    // MARK: - Helpers
    private func addCommonHeaders(to request: inout URLRequest, key: String) {
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue(notionVersion, forHTTPHeaderField: "Notion-Version")
    }
    
    // Centralized request sender to remove duplicated URLSession/request boilerplate
    private func performRequest(path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Data {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        let url = apiBase.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        addCommonHeaders(to: &request, key: key)
        if let b = body {
            request.httpBody = try JSONSerialization.data(withJSONObject: b, options: [])
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureSuccess(response: response, data: data)
        return data
    }

    // Overload that accepts a full URL (used for URLComponents-built URLs)
    private func performRequest(url: URL, method: String = "GET", body: [String: Any]? = nil) async throws -> Data {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        addCommonHeaders(to: &request, key: key)
        if let b = body {
            request.httpBody = try JSONSerialization.data(withJSONObject: b, options: [])
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureSuccess(response: response, data: data)
        return data
    }
    
    private static func ensureSuccess(response: URLResponse, data: Data) throws {
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "NotionService", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "HTTP \(http.statusCode): \(body)"])
        }
    }
}
