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
        var collected: [String: String] = [:]
        var startCursor: String? = nil
        repeat {
            var components = requestHelper.makeURLComponents(path: "blocks/\(pageId)/children")
            if let cursor = startCursor {
                components.queryItems = [URLQueryItem(name: "start_cursor", value: cursor)]
            }
            let data = try await requestHelper.performRequest(url: components.url!, method: "GET", body: nil)
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
}
