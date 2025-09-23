import Foundation

final class NotionService: NotionServiceProtocol {
    private let configStore: NotionConfigStoreProtocol
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
    
    // MARK: - Public API
    func createDatabase(title: String) async throws -> NotionDatabase {
        guard let pageId = configStore.notionPageId, let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        
        let url = apiBase.appendingPathComponent("databases")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        addCommonHeaders(to: &request, key: key)
        
        // Create properties for book-focused database: Name (title), Author (rich_text), Highlight Count (number)
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
                "URL": ["url": [:]]
            ]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureSuccess(response: response, data: data)
        return try JSONDecoder().decode(NotionDatabase.self, from: data)
    }
    
    func createPage(databaseId: String, pageTitle: String, header: String?) async throws -> NotionPage {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        
        let url = apiBase.appendingPathComponent("pages")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        addCommonHeaders(to: &request, key: key)
        
        var children: [[String: Any]] = []
        if let header = header, !header.isEmpty {
            children = [[
                "object": "block",
                "heading_2": [
                    "rich_text": [[
                        "text": ["content": header]
                    ]]
                ]
            ]]
        }
        
        let body: [String: Any] = [
            "parent": [
                "type": "database_id",
                "database_id": databaseId
            ],
            "properties": [
                // Provide both English and Chinese title keys so pages created by this demo
                // work whether the database primary property is "Name" or "书名".
                "Name": [
                    "title": [[
                        "text": ["content": pageTitle]
                    ]]
                ],
                "书名": [
                    "title": [[
                        "text": ["content": pageTitle]
                    ]]
                ]
            ],
            "children": children
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureSuccess(response: response, data: data)
        return try JSONDecoder().decode(NotionPage.self, from: data)
    }
    
    func appendParagraph(pageId: String, content: String) async throws -> NotionAppendResult {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        
        let url = apiBase.appendingPathComponent("blocks/\(pageId)/children")
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        addCommonHeaders(to: &request, key: key)
        
        let body: [String: Any] = [
            "children": [[
                "paragraph": [
                    "rich_text": [["text": ["content": content]]]
                ]
            ]]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureSuccess(response: response, data: data)
        return try JSONDecoder().decode(NotionAppendResult.self, from: data)
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
        
        let url = apiBase.appendingPathComponent("search")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        addCommonHeaders(to: &request, key: key)
        let body: [String: Any] = [
            "query": title,
            "filter": ["value": "database", "property": "object"],
            "sort": ["direction": "ascending", "timestamp": "last_edited_time"]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureSuccess(response: response, data: data)
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
        let url = apiBase.appendingPathComponent("databases/\(databaseId)/query")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        addCommonHeaders(to: &request, key: key)
        let body: [String: Any] = [
            "filter": [
                "property": "Asset ID",
                "rich_text": ["equals": assetId]
            ],
            "page_size": 1
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureSuccess(response: response, data: data)
        let decoded = try JSONDecoder().decode(QueryResponse.self, from: data)
        return decoded.results.first?.id
    }
    
    func createBookPage(databaseId: String, bookTitle: String, author: String, assetId: String, urlString: String?, header: String?) async throws -> NotionPage {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        let url = apiBase.appendingPathComponent("pages")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        addCommonHeaders(to: &request, key: key)
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
        if let urlString, !urlString.isEmpty {
            properties["URL"] = ["url": urlString]
        }
        var children: [[String: Any]] = []
        if let header, !header.isEmpty {
            children = [[
                "object": "block",
                "heading_2": [
                    "rich_text": [["text": ["content": header]]]
                ]
            ]]
        }
        let body: [String: Any] = [
            "parent": ["type": "database_id", "database_id": databaseId],
            "properties": properties,
            "children": children
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureSuccess(response: response, data: data)
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
            var request = URLRequest(url: components.url!)
            request.httpMethod = "GET"
            addCommonHeaders(to: &request, key: key)
            let (data, response) = try await URLSession.shared.data(for: request)
            try Self.ensureSuccess(response: response, data: data)
            let decoded = try JSONDecoder().decode(BlockChildrenResponse.self, from: data)
            for block in decoded.results {
                let holder = block.paragraph ?? block.bulleted_list_item
                let texts = holder?.rich_text ?? []
                for t in texts {
                    if let s = t.plain_text {
                        print("DEBUG: 检查文本内容: \(s)")
                        // 查找 "[uuid:" 和 "]" 之间的内容
                        if let startRange = s.range(of: "[uuid:") {
                            let startIdx = startRange.upperBound // 跳过 "[uuid:"
                            if let endRange = s.range(of: "]", range: startIdx..<s.endIndex) {
                                let idPart = String(s[startIdx..<endRange.lowerBound])
                                collected[idPart] = block.id
                                print("DEBUG: 找到UUID映射 - UUID: \(idPart), Block ID: \(block.id)")
                            } else {
                                print("DEBUG: 未找到结束括号]")
                            }
                        }
                    }
                }
            }
            startCursor = decoded.has_more ? decoded.next_cursor : nil
        } while startCursor != nil
        print("DEBUG: 收集到 \(collected.count) 个UUID到块ID的映射")
        return collected
    }
    
    func appendHighlightBullets(pageId: String, bookId: String, highlights: [HighlightRow]) async throws {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        let url = apiBase.appendingPathComponent("blocks/\(pageId)/children")
        // Chunk into batches of up to 80 blocks to be safe
        let batchSize = 80
        var index = 0
        while index < highlights.count {
            let slice = Array(highlights[index..<min(index + batchSize, highlights.count)])
            var request = URLRequest(url: url)
            request.httpMethod = "PATCH"
            addCommonHeaders(to: &request, key: key)
            let children: [[String: Any]] = slice.map { h in
                var rt: [[String: Any]] = []
                // Highlight text
                rt.append(["text": ["content": h.text]])
                // Optional note
                if let note = h.note, !note.isEmpty {
                    rt.append(["text": ["content": " — Note: \(note)"], "annotations": ["italic": true]])
                }
                // Add metadata (style, creation, modification) when available
                var metaParts: [String] = []
                if let s = h.style { metaParts.append("style:\(s)") }
                if let d = h.dateAdded { metaParts.append("added:\(Self.isoDateFormatter.string(from: d))") }
                if let m = h.modified { metaParts.append("modified:\(Self.isoDateFormatter.string(from: m))") }
                if !metaParts.isEmpty {
                    rt.append(["text": ["content": " — \(metaParts.joined(separator: " | "))"], "annotations": ["italic": true]])
                }
                // Optional link
                let linkUrl: String
                if let loc = h.location, !loc.isEmpty {
                    linkUrl = "ibooks://assetid/\(bookId)#\(loc)"
                } else {
                    linkUrl = "ibooks://assetid/\(bookId)"
                }
                rt.append(["text": ["content": "  Open ↗"], "href": linkUrl])
                // UUID marker for idempotency
                rt.append(["text": ["content": " [uuid:\(h.uuid)]"], "annotations": ["code": true]])
                return [
                    "object": "block",
                    "bulleted_list_item": ["rich_text": rt]
                ]
            }
            // Delegate to generalized appendBlocks so that callers can reuse
            try await appendBlocks(pageId: pageId, children: children)
            index += batchSize
        }
    }

    func appendBlocks(pageId: String, children: [[String: Any]]) async throws {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        let url = apiBase.appendingPathComponent("blocks/\(pageId)/children")
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        addCommonHeaders(to: &request, key: key)
        let body: [String: Any] = ["children": children]
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureSuccess(response: response, data: data)
        _ = data
    }
    
    func updatePageHighlightCount(pageId: String, count: Int) async throws {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        let url = apiBase.appendingPathComponent("pages/\(pageId)")
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        addCommonHeaders(to: &request, key: key)
        let body: [String: Any] = [
            "properties": [
                "Highlight Count": ["number": count]
            ]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureSuccess(response: response, data: data)
        _ = data
    }

    func updateBlockContent(blockId: String, highlight: HighlightRow, bookId: String) async throws {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }

        let url = apiBase.appendingPathComponent("blocks/\(blockId)")
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        addCommonHeaders(to: &request, key: key)

        // 构建富文本内容
        var rt: [[String: Any]] = []
        // Highlight text
        rt.append(["text": ["content": highlight.text]])
        // Optional note
        if let note = highlight.note, !note.isEmpty {
            rt.append(["text": ["content": " — Note: \(note)"], "annotations": ["italic": true]])
        }
        // Add metadata (style, creation, modification) when available
        var metaParts: [String] = []
        if let s = highlight.style { metaParts.append("style:\(s)") }
        if let d = highlight.dateAdded { metaParts.append("added:\(Self.isoDateFormatter.string(from: d))") }
        if let m = highlight.modified { metaParts.append("modified:\(Self.isoDateFormatter.string(from: m))") }
        if !metaParts.isEmpty {
            rt.append(["text": ["content": " — \(metaParts.joined(separator: " | "))"], "annotations": ["italic": true]])
        }
        // Optional link
        let linkUrl: String
        if let loc = highlight.location, !loc.isEmpty {
            linkUrl = "ibooks://assetid/\(bookId)#\(loc)"
        } else {
            linkUrl = "ibooks://assetid/\(bookId)"
        }
        rt.append(["text": ["content": "  Open ↗"], "href": linkUrl])
        // UUID marker for idempotency
        rt.append(["text": ["content": " [uuid:\(highlight.uuid)]"], "annotations": ["code": true]])

        let body: [String: Any] = [
            "bulleted_list_item": ["rich_text": rt]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureSuccess(response: response, data: data)
        _ = data
    }
    
    // MARK: - Helpers
    private func addCommonHeaders(to request: inout URLRequest, key: String) {
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue(notionVersion, forHTTPHeaderField: "Notion-Version")
    }
    
    private static func ensureSuccess(response: URLResponse, data: Data) throws {
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "NotionService", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "HTTP \(http.statusCode): \(body)"])
        }
    }
}


