import Foundation

/// Notion 页面操作类
class NotionPageOperations {
    private let requestHelper: NotionRequestHelper

    init(requestHelper: NotionRequestHelper) {
        self.requestHelper = requestHelper
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

    /// Append children with retry/split behavior. Exposed so callers can reuse the robust append behavior.
    func appendChildrenWithRetry(pageId: String, children: [[String: Any]], batchSize: Int = 80, trimOnFailureLengths: [Int] = [1800, 1000]) async throws {
        let logger = DIContainer.shared.loggerService

        func attemptAppendSlice(_ slice: ArraySlice<[String: Any]>, trimLengths: [Int]) async throws {
            let payloadChildren = Array(slice)
            do {
                try await appendBlocks(pageId: pageId, children: payloadChildren)
            } catch {
                if slice.count > 1 {
                    let mid = slice.startIndex + slice.count / 2
                    try await attemptAppendSlice(slice[slice.startIndex..<mid], trimLengths: trimLengths)
                    try await attemptAppendSlice(slice[mid..<slice.endIndex], trimLengths: trimLengths)
                } else if let single = slice.first {
                    // single item failed — try trimming if possible
                    if let length = trimLengths.first, length > 0 {
                        // attempt to trim deeply nested rich_text contents if present
                        let trimmed = single
                        func trimBlock(_ block: [String: Any], to maxLen: Int) -> [String: Any] {
                            var b = block
                            if var bulleted = b["bulleted_list_item"] as? [String: Any], var rich = bulleted["rich_text"] as? [[String: Any]], !rich.isEmpty {
                                // Trim first text element
                                var first = rich[0]
                                if var text = first["text"] as? [String: Any], let content = text["content"] as? String, content.count > maxLen {
                                    text["content"] = String(content.prefix(maxLen))
                                    first["text"] = text
                                    rich[0] = first
                                    bulleted["rich_text"] = rich
                                    b["bulleted_list_item"] = bulleted
                                }
                            }
                            return b
                        }
                        let trimmedSingle = trimBlock(trimmed, to: length)
                        do {
                            try await appendBlocks(pageId: pageId, children: [trimmedSingle])
                        } catch {
                            // if still fails and more trim lengths available, try next
                            if trimLengths.count > 1 {
                                let remaining = Array(trimLengths.dropFirst())
                                // recurse with same single slice but next trim lengths
                                try await attemptAppendSlice(slice, trimLengths: remaining)
                            } else {
                                logger.warning("Skip one highlight due to Notion API error when appending single child: \(error.localizedDescription)")
                            }
                        }
                    } else {
                        logger.warning("Skip one highlight due to Notion API error when appending single child: \(error.localizedDescription)")
                    }
                }
            }
        }

        var index = 0
        while index < children.count {
            let end = min(index + batchSize, children.count)
            let slice = children[index..<end]
            try await attemptAppendSlice(slice, trimLengths: trimOnFailureLengths)
            index = end
        }
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
