import Foundation

/// Notion 页面操作类
class NotionPageOperations {
    private let requestHelper: NotionRequestHelper
    private let helperMethods: NotionHelperMethods

    init(requestHelper: NotionRequestHelper, helperMethods: NotionHelperMethods) {
        self.requestHelper = requestHelper
        self.helperMethods = helperMethods
    }

    func createBookPage(databaseId: String, bookTitle: String, author: String, assetId: String, urlString: String?, header: String?) async throws -> NotionPage {
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
        let body: [String: Any] = [
            "parent": ["type": "database_id", "database_id": databaseId],
            "properties": properties,
            "children": children
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
    
    /// 追加 blocks 并返回新创建的 block IDs
    /// Notion API 的响应会包含新创建的 block 对象列表
    func appendBlocksAndGetIds(pageId: String, children: [[String: Any]]) async throws -> [String] {
        let data = try await requestHelper.performRequest(path: "blocks/\(pageId)/children", method: "PATCH", body: ["children": children])
        
        // 解析响应获取 block IDs
        struct AppendBlocksResponse: Decodable {
            struct Block: Decodable {
                let id: String
            }
            let results: [Block]
        }
        
        let response = try JSONDecoder().decode(AppendBlocksResponse.self, from: data)
        return response.results.map { $0.id }
    }

    /// Append children in batches. Simpler and deterministic (no retry/trim fallback).
    func appendChildren(pageId: String, children: [[String: Any]], batchSize: Int = NotionSyncConfig.defaultAppendBatchSize) async throws {
        var index = 0
        while index < children.count {
            let end = min(index + batchSize, children.count)
            let slice = Array(children[index..<end])
            try await appendBlocks(pageId: pageId, children: slice)
            index = end
        }
    }
    
    /// 追加 children 并返回所有新创建的 block IDs（分批处理）
    func appendChildrenAndGetIds(pageId: String, children: [[String: Any]], batchSize: Int = NotionSyncConfig.defaultAppendBatchSize) async throws -> [String] {
        var allBlockIds: [String] = []
        var index = 0
        while index < children.count {
            let end = min(index + batchSize, children.count)
            let slice = Array(children[index..<end])
            let blockIds = try await appendBlocksAndGetIds(pageId: pageId, children: slice)
            allBlockIds.append(contentsOf: blockIds)
            index = end
        }
        return allBlockIds
    }

    func replacePageChildren(pageId: String, with children: [[String: Any]]) async throws {
        // 1) List existing children
        var startCursor: String? = nil
        var existing: [NotionQueryOperations.BlockChildrenResponse.Block] = []
        repeat {
            var components = requestHelper.makeURLComponents(path: "blocks/\(pageId)/children")
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
            let delURL = requestHelper.makeURL(path: "blocks/\(block.id)")
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
