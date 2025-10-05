import Foundation

/// Notion 页面操作类
class NotionPageOperations {
    private let requestHelper: NotionRequestHelper

    init(requestHelper: NotionRequestHelper) {
        self.requestHelper = requestHelper
    }

    func createPage(in databaseId: String, properties: [String: Any], children: [[String: Any]]?) async throws -> NotionPage {
        var body: [String: Any] = [
            "parent": ["type": "database_id", "database_id": databaseId],
            "properties": properties
        ]
        if let children, !children.isEmpty {
            body["children"] = children
        }
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

    func updateBulletedListItem(blockId: String, richText: [[String: Any]]) async throws {
        _ = try await requestHelper.performRequest(path: "blocks/\(blockId)", method: "PATCH", body: ["bulleted_list_item": ["rich_text": richText]])
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
