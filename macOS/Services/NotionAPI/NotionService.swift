import Foundation

// MARK: - NotionService

/// Lightweight client for Notion REST API.
/// Implements just the endpoints we need: query database, create page, update page properties, append blocks.
class NotionService {
    // MARK: - Types
    struct Configuration {
        let apiToken: String
        /// Notion API version header. See: https://developers.notion.com/docs/getting-started
        let apiVersion: String
        init(apiToken: String, apiVersion: String = "2025-09-03") {
            self.apiToken = apiToken
            self.apiVersion = apiVersion
        }
    }

    struct NotionQueryResponse: Decodable {
        struct Page: Decodable { let id: String }
        let results: [Page]
        let next_cursor: String?
        let has_more: Bool
    }

    // MARK: - Properties
    private let configuration: Configuration
    private let urlSession: URLSession

    // MARK: - Initialization
    init(configuration: Configuration, urlSession: URLSession = .shared) {
        self.configuration = configuration
        self.urlSession = urlSession
        AppLogger.shared.debug("NotionService initialized (version=\(configuration.apiVersion))")
    }

    // MARK: - Public API
    /// Fetch a database by id to validate accessibility and existence.
    /// Returns minimal info (id and url) if accessible.
    func fetchDatabase(databaseId: String) async throws -> (id: String, url: String?) {
        let url = URL(string: "https://api.notion.com/v1/databases/\(databaseId)")!
        var request = makeRequest(url: url, method: "GET")
        AppLogger.shared.debug("Fetching Notion database info id=\(databaseId)")
        let (data, response) = try await urlSession.data(for: request)
        try Self.throwIfNotOK(response: response, data: data)
        struct DB: Decodable { let id: String; let url: String? }
        let db = try JSONDecoder().decode(DB.self, from: data)
        return (db.id, db.url)
    }

    /// Query a database by property equality. Returns the first matching page id if any.
    func queryDatabaseForPageId(databaseId: String, propertyName: String, equals value: String) async throws -> String? {
        let url = URL(string: "https://api.notion.com/v1/databases/\(databaseId)/query")!
        var request = makeRequest(url: url, method: "POST")
        AppLogger.shared.debug("Querying database \(databaseId) for property '\(propertyName)' == '\(value)'")
        let body: [String: Any] = [
            "filter": [
                "property": propertyName,
                "rich_text": [
                    "equals": value
                ]
            ]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await urlSession.data(for: request)
        AppLogger.shared.debug("Received \(data.count) bytes from Notion query")
        try Self.throwIfNotOK(response: response, data: data)
        let decoded = try JSONDecoder().decode(NotionQueryResponse.self, from: data)
        return decoded.results.first?.id
    }

    /// Create a book page under a database with the given properties.
    func createBookPage(databaseId: String,
                        title: String,
                        author: String,
                        bookId: String,
                        ibooksURL: String,
                        highlightCount: Int?) async throws -> String {
        let url = URL(string: "https://api.notion.com/v1/pages")!
        var request = makeRequest(url: url, method: "POST")

        var properties: [String: Any] = [
            "Name": [
                "title": [["type": "text", "text": ["content": title]]]
            ],
            "Author": [
                "rich_text": [["type": "text", "text": ["content": author]]]
            ],
            "Book ID": [
                "rich_text": [["type": "text", "text": ["content": bookId]]]
            ],
            "iBooks URL": [
                "url": ibooksURL
            ],
            "Last Synced": [
                "date": ["start": ISO8601DateFormatter().string(from: Date())]
            ]
        ]
        if let cnt = highlightCount {
            properties["Highlight Count"] = ["number": cnt]
        }

        let body: [String: Any] = [
            "parent": ["database_id": databaseId],
            "properties": properties
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        AppLogger.shared.debug("Creating Notion page for bookId=\(bookId) title='\(title)' (db=\(databaseId)) payload=\(request.httpBody?.count ?? 0) bytes")
        let (data, response) = try await urlSession.data(for: request)
        AppLogger.shared.debug("Create page response bytes=\(data.count)")
        try Self.throwIfNotOK(response: response, data: data)
        let id = try Self.extractId(from: data)
        AppLogger.shared.info("Created Notion page id=\(id) for bookId=\(bookId)")
        return id
    }

    /// Update properties on an existing page.
    func updatePageProperties(pageId: String, properties: [String: Any]) async throws {
        let url = URL(string: "https://api.notion.com/v1/pages/\(pageId)")!
        var request = makeRequest(url: url, method: "PATCH")
        let body: [String: Any] = [
            "properties": properties
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        AppLogger.shared.debug("Updating Notion page \(pageId) properties=\(properties.keys) payload=\(request.httpBody?.count ?? 0) bytes")
        let (data, response) = try await urlSession.data(for: request)
        AppLogger.shared.debug("Update page response bytes=\(data.count)")
        try Self.throwIfNotOK(response: response, data: data)
        AppLogger.shared.info("Updated Notion page \(pageId)")
    }

    /// Append child blocks to a page. Chunking should be done by caller if needed.
    func appendBlocks(pageId: String, blocks: [[String: Any]]) async throws {
        let url = URL(string: "https://api.notion.com/v1/blocks/\(pageId)/children")!
        var request = makeRequest(url: url, method: "PATCH")
        let body: [String: Any] = [
            "children": blocks
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        AppLogger.shared.debug("Appending \(blocks.count) blocks to Notion page \(pageId)")
        let (data, response) = try await urlSession.data(for: request)
        AppLogger.shared.debug("Append blocks response bytes=\(data.count)")
        try Self.throwIfNotOK(response: response, data: data)
        AppLogger.shared.info("Appended \(blocks.count) blocks to page \(pageId)")
    }

    // MARK: - Helpers
    private func makeRequest(url: URL, method: String) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(configuration.apiToken)", forHTTPHeaderField: "Authorization")
        request.setValue(configuration.apiVersion, forHTTPHeaderField: "Notion-Version")
        return request
    }

    private static func throwIfNotOK(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        if (200..<300).contains(http.statusCode) { return }
        let body = String(data: data, encoding: .utf8) ?? "<no body>"
        AppLogger.shared.error("Notion API error HTTP \(http.statusCode): \(body)")
        throw NSError(domain: "NotionService", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "HTTP \(http.statusCode): \(body)"])
    }

    private static func extractId(from data: Data) throws -> String {
        struct Obj: Decodable { let id: String }
        return try JSONDecoder().decode(Obj.self, from: data).id
    }
}

// MARK: - Block Builders

extension NotionService {
    /// Build a toggle block for a highlight with optional note and metadata.
    static func buildHighlightToggle(text: String,
                                     note: String?,
                                     created: Date?,
                                     modified: Date?,
                                     deepLink: String?,
                                     uuid: String?,
                                     style: Int?,
                                     location: String?) -> [String: Any] {
        var children: [[String: Any]] = []

        if let note = note, !note.isEmpty {
            children.append(paragraphBlock(text: note))
        }

        // Metadata line
        var metaItems: [String] = []
        if let created = created {
            metaItems.append("创建: \(ISO8601DateFormatter().string(from: created))")
        }
        if let modified = modified {
            metaItems.append("修改: \(ISO8601DateFormatter().string(from: modified))")
        }
        if let style = style {
            metaItems.append("样式: \(style)")
        }
        if let location = location, !location.isEmpty {
            metaItems.append("位置: \(location)")
        }
        if let uuid = uuid, !uuid.isEmpty {
            metaItems.append("UUID: \(uuid)")
        }
        if !metaItems.isEmpty {
            children.append(paragraphBlock(text: metaItems.joined(separator: "  •  ")))
        }

        if let deepLink = deepLink, let url = URL(string: deepLink) {
            children.append(paragraphBlock(text: "Open in Apple Books", link: url))
        }

        return [
            "object": "block",
            "type": "toggle",
            "toggle": [
                "rich_text": richTextArray(from: text),
                "children": children
            ]
        ]
    }

    static func paragraphBlock(text: String, link: URL? = nil) -> [String: Any] {
        return [
            "object": "block",
            "type": "paragraph",
            "paragraph": [
                "rich_text": richTextArray(from: text, link: link)
            ]
        ]
    }

    static func richTextArray(from text: String, link: URL? = nil) -> [[String: Any]] {
        var textObject: [String: Any] = [
            "type": "text",
            "text": ["content": text]
        ]
        if let link = link {
            textObject["text"] = [
                "content": text,
                "link": ["url": link.absoluteString]
            ]
        }
        return [textObject]
    }
}


