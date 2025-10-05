import Foundation

/// Notion 数据库操作类
class NotionDatabaseOperations {
    private let requestHelper: NotionRequestHelper

    init(requestHelper: NotionRequestHelper) {
        self.requestHelper = requestHelper
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

    func createDatabase(title: String, pageId: String) async throws -> NotionDatabase {
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
        let data = try await requestHelper.performRequest(path: "databases", method: "POST", body: body)
        return try JSONDecoder().decode(NotionDatabase.self, from: data)
    }

    func createPerBookHighlightDatabase(bookTitle: String, author: String, assetId: String, pageId: String) async throws -> NotionDatabase {
        // Database title uses book title for clarity
        let dbTitle = "SyncNos - \(bookTitle)"

        // Properties for highlight items（Style 采用 rich_text 以承载 "颜色名_数字" 文本）
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
        let data = try await requestHelper.performRequest(path: "databases", method: "POST", body: body)
        return try JSONDecoder().decode(NotionDatabase.self, from: data)
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
