import Foundation

/// Notion 数据库操作类
class NotionDatabaseOperations {
    private let requestHelper: NotionRequestHelper
    private let appleBooksHelper: NotionAppleBooksHelperProtocol

    init(requestHelper: NotionRequestHelper, appleBooksHelper: NotionAppleBooksHelperProtocol) {
        self.requestHelper = requestHelper
        self.appleBooksHelper = appleBooksHelper
    }

    // Lightweight exists check by querying minimal page
    func databaseExists(databaseId: String) async -> Bool {
        // Keep behavior: return false when not configured or any non-2xx / error occurs
        struct DatabaseMeta: Decodable { let id: String; let in_trash: Bool? }
        do {
            let data = try await requestHelper.performRequest(path: "databases/\(databaseId)", method: "GET", body: nil)
            if let meta = try? JSONDecoder().decode(DatabaseMeta.self, from: data), (meta.in_trash ?? false) {
                return false
            }
            // Some trashed databases still return 200 on GET; verify by running a minimal query
            _ = try await requestHelper.performRequest(path: "databases/\(databaseId)/query", method: "POST", body: ["page_size": 1])
            return true
        } catch {
            return false
        }
    }

    func createDatabase(title: String, pageId: String, properties: [String: Any]? = nil) async throws -> NotionDatabase {
        var body: [String: Any] = [
            "parent": [
                "type": "page_id",
                "page_id": pageId
            ],
            "title": [[
                "type": "text",
                "text": ["content": title]
            ]]
        ]
        if let props = properties {
            body["properties"] = props
        } else {
            body["properties"] = [
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
        }
        let data = try await requestHelper.performRequest(path: "databases", method: "POST", body: body)
        return try JSONDecoder().decode(NotionDatabase.self, from: data)
    }

    func createPerBookHighlightDatabase(bookTitle: String, author: String, assetId: String, pageId: String) async throws -> NotionDatabase {
        let (dbTitle, properties) = appleBooksHelper.perBookDatabaseProperties(bookTitle: bookTitle, author: author, assetId: assetId)
        return try await createDatabase(title: dbTitle, pageId: pageId, properties: properties)
    }

    func findDatabaseId(title: String, parentPageId: String) async throws -> String? {
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

        let body: [String: Any] = [
            "query": title,
            "filter": ["value": "database", "property": "object"],
            "sort": ["direction": "ascending", "timestamp": "last_edited_time"]
        ]
        let data = try await requestHelper.performRequest(path: "search", method: "POST", body: body)
        let decoded = try JSONDecoder().decode(SearchResponse.self, from: data)
        for r in decoded.results where r.object == "database" {
            let t = (r.title ?? []).compactMap { $0.plain_text }.joined()
            if t.caseInsensitiveCompare(title) == .orderedSame, r.parent?.page_id == parentPageId {
                return r.id
            }
        }
        return nil
    }

    func ensureDatabaseProperties(databaseId: String, definitions: [String: Any]) async throws {
        _ = try await requestHelper.performRequest(path: "databases/\(databaseId)", method: "PATCH", body: ["properties": definitions])
    }
}
