import Foundation

/// Notion 查询操作类
class NotionQueryOperations {
    private let requestHelper: NotionRequestHelper
    private let logger: LoggerServiceProtocol

    init(requestHelper: NotionRequestHelper, logger: LoggerServiceProtocol) {
        self.requestHelper = requestHelper
        self.logger = logger
    }

    struct QueryResponse: Decodable {
        struct Page: Decodable { let id: String }
        let results: [Page]
        let has_more: Bool?
        let next_cursor: String?
    }

    func findPageIdByAssetId(databaseId: String, assetId: String) async throws -> String? {
        let body: [String: Any] = [
            "filter": [
                "property": "Asset ID",
                "rich_text": ["equals": assetId]
            ],
            "page_size": 1
        ]
        let data = try await requestHelper.performRequest(path: "databases/\(databaseId)/query", method: "POST", body: body)
        let decoded = try JSONDecoder().decode(QueryResponse.self, from: data)
        return decoded.results.first?.id
    }

    func findHighlightItemPageIdByUUID(databaseId: String, uuid: String) async throws -> String? {
        let body: [String: Any] = [
            "filter": [
                "property": "UUID",
                "rich_text": ["equals": uuid]
            ],
            "page_size": 1
        ]
        let data = try await requestHelper.performRequest(path: "databases/\(databaseId)/query", method: "POST", body: body)
        let decoded = try JSONDecoder().decode(QueryResponse.self, from: data)
        return decoded.results.first?.id
    }

    struct BlockChildrenResponse: Decodable {
        struct RichText: Decodable { let plain_text: String? }
        struct RichTextHolder: Decodable { let rich_text: [RichText]? }
        struct Block: Decodable {
            let id: String
            let type: String
            let has_children: Bool?
            let paragraph: RichTextHolder?
            let bulleted_list_item: RichTextHolder?
            let numbered_list_item: RichTextHolder?
        }
        let results: [Block]
        let has_more: Bool
        let next_cursor: String?
    }

    func collectExistingUUIDs(fromPageId pageId: String) async throws -> Set<String> {
        let mapping = try await collectExistingUUIDMapWithToken(fromPageId: pageId)
        return Set(mapping.keys)
    }

    /// 收集 UUID -> (blockId, token) 映射，其中 token 来自父块 rich_text 第二行的 `modified:` 值
    func collectExistingUUIDMapWithToken(fromPageId pageId: String) async throws -> [String: (blockId: String, token: String?)] {
        var collected: [String: (blockId: String, token: String?)] = [:]
        var startCursor: String? = nil
        repeat {
            var components = requestHelper.makeURLComponents(path: "blocks/\(pageId)/children")
            if let cursor = startCursor {
                components.queryItems = [URLQueryItem(name: "start_cursor", value: cursor)]
            }
            let data = try await requestHelper.performRequest(url: components.url!, method: "GET", body: nil)
            let decoded = try JSONDecoder().decode(BlockChildrenResponse.self, from: data)
            for block in decoded.results {
                // 合并 parent rich_text 文本内容，便于解析两行头
                var texts: [BlockChildrenResponse.RichText] = []
                if let p = block.paragraph?.rich_text { texts = p }
                else if let b = block.bulleted_list_item?.rich_text { texts = b }
                else if let n = block.numbered_list_item?.rich_text { texts = n }

                if texts.isEmpty { continue }
                let joined = texts.compactMap { $0.plain_text }.joined()

                // UUID
                guard let startRange = joined.range(of: "[uuid:") else { continue }
                guard let endRange = joined.range(of: "]", range: startRange.upperBound..<joined.endIndex) else { continue }
                let uuid = String(joined[startRange.upperBound..<endRange.lowerBound])

                // Token: 第二行中 `modified:` 的值
                var token: String? = nil
                let lines = joined.components(separatedBy: "\n")
                if lines.count >= 2 {
                    let metaLine = lines[1]
                    // 解析形如 key:value | key:value | modified:token
                    let parts = metaLine.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
                    for part in parts {
                        if part.hasPrefix("modified:") {
                            token = String(part.dropFirst("modified:".count))
                                .trimmingCharacters(in: .whitespaces)
                            break
                        }
                    }
                }
                collected[uuid] = (block.id, token)
            }
            startCursor = decoded.has_more ? decoded.next_cursor : nil
        } while startCursor != nil
        return collected
    }
}
