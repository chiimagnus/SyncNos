import Foundation

/// Notion 页面操作类
class NotionPageOperations {
    private let requestHelper: NotionRequestHelper
    private let appleBooksHelper: NotionAppleBooksHelperProtocol

    init(requestHelper: NotionRequestHelper, appleBooksHelper: NotionAppleBooksHelperProtocol = DefaultNotionAppleBooksHelper()) {
        self.requestHelper = requestHelper
        self.appleBooksHelper = appleBooksHelper
    }

    func createBookPage(databaseId: String, bookTitle: String, author: String, assetId: String, urlString: String?, header: String?) async throws -> NotionPage {
        // Use helper to build properties and children
        let pageInfo = appleBooksHelper.buildBookPageProperties(bookTitle: bookTitle, author: author, assetId: assetId, urlString: urlString, header: header)
        let body: [String: Any] = [
            "parent": ["type": "database_id", "database_id": databaseId],
            "properties": pageInfo.properties,
            "children": pageInfo.children
        ]
        let data = try await requestHelper.performRequest(path: "pages", method: "POST", body: body)
        return try JSONDecoder().decode(NotionPage.self, from: data)
    }

    func updatePageHighlightCount(pageId: String, count: Int) async throws {
        _ = try await requestHelper.performRequest(path: "pages/\(pageId)", method: "PATCH", body: ["properties": ["Highlight Count": ["number": count]]])
    }

    func updatePageProperties(pageId: String, properties: [String: Any]) async throws {
        _ = try await requestHelper.performRequest(path: "pages/\(pageId)", method: "PATCH", body: ["properties": properties])
    }

    func appendBlocks(pageId: String, children: [[String: Any]]) async throws {
        _ = try await requestHelper.performRequest(path: "blocks/\(pageId)/children", method: "PATCH", body: ["children": children])
    }

    func replacePageChildren(pageId: String, with children: [[String: Any]]) async throws {
        // 1) List existing children
        var startCursor: String? = nil
        var existing: [NotionQueryOperations.BlockChildrenResponse.Block] = []
        repeat {
            var components = URLComponents(url: URL(string: "https://api.notion.com/v1/")!.appendingPathComponent("blocks/\(pageId)/children"), resolvingAgainstBaseURL: false)!
            if let cursor = startCursor {
                components.queryItems = [URLQueryItem(name: "start_cursor", value: cursor)]
            }
            let data = try await requestHelper.performRequest(url: components.url!, method: "GET", body: nil)
            let decoded = try JSONDecoder().decode(NotionQueryOperations.BlockChildrenResponse.self, from: data)
            existing.append(contentsOf: decoded.results)
            startCursor = decoded.has_more ? decoded.next_cursor : nil
        } while startCursor != nil

        // 2) Delete existing children
        for block in existing {
            let delURL = URL(string: "https://api.notion.com/v1/")!.appendingPathComponent("blocks/\(block.id)")
            // Best-effort delete: ignore failures
            _ = try? await requestHelper.performRequest(url: delURL, method: "DELETE", body: nil)
        }

        // 3) Append new children
        try await appendBlocks(pageId: pageId, children: children)
    }

    // Expose as protocol method
    func setPageChildren(pageId: String, children: [[String: Any]]) async throws {
        try await replacePageChildren(pageId: pageId, with: children)
    }
}
