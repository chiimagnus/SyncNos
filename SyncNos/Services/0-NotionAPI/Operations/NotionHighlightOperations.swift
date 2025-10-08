import Foundation

/// Notion 高亮操作类
class NotionHighlightOperations {
    private let requestHelper: NotionRequestHelper
    private let helperMethods: NotionHelperMethods
    private let pageOperations: NotionPageOperations
    private let logger: LoggerServiceProtocol

    init(requestHelper: NotionRequestHelper, helperMethods: NotionHelperMethods, pageOperations: NotionPageOperations, logger: LoggerServiceProtocol) {
        self.requestHelper = requestHelper
        self.helperMethods = helperMethods
        self.pageOperations = pageOperations
        self.logger = logger
    }

    func appendHighlightBullets(pageId: String, bookId: String, highlights: [HighlightRow]) async throws {
        // 上层会批次调用此函数。这里实现安全的分片/降级递归，遇到单条失败尝试内容裁剪；仍失败则跳过该条，保证后续条目不被拖累。
        func buildBlocks(for h: HighlightRow) -> [[String: Any]] {
            // If text is short enough, use existing single-block representation (parent with note+meta as children)
            if h.text.count <= NotionSyncConfig.maxTextLengthPrimary {
                return [helperMethods.buildBulletedListItemBlock(for: h, bookId: bookId, maxTextLength: NotionSyncConfig.maxTextLengthPrimary)]
            }

            // Long text: split into chunks. First chunk becomes parent block; remaining chunks become children of parent.
            let chunks = BlockSplitter.split(h.text)
            var blocks: [[String: Any]] = []
            guard !chunks.isEmpty else { return blocks }

            // parent rich_text contains first chunk and uuid marker
            let parentRt = helperMethods.buildParentRichText(fromChunk: chunks[0] + "\n[uuid:\(h.uuid)]")
            var parent: [String: Any] = [
                "object": "block",
                "numbered_list_item": [
                    "rich_text": parentRt
                ]
            ]

            // build children paragraphs from remaining chunks
            if chunks.count > 1 {
                var childBlocks: [[String: Any]] = []
                for idx in 1..<chunks.count {
                    let rt = helperMethods.buildParentRichText(fromChunk: chunks[idx])
                    let paragraphBlock: [String: Any] = [
                        "object": "block",
                        "paragraph": ["rich_text": rt]
                    ]
                    childBlocks.append(paragraphBlock)
                }
                // attach children to parent
                if var numbered = parent["numbered_list_item"] as? [String: Any] {
                    numbered["children"] = childBlocks
                    parent["numbered_list_item"] = numbered
                }
            }

            // parent block first
            blocks.append(parent)

            // note and meta should be siblings to parent (per requirement)
            if let noteChild = helperMethods.buildNoteChild(for: h) {
                blocks.append(noteChild)
            }
            blocks.append(helperMethods.buildMetaAndLinkChild(for: h, bookId: bookId))

            return blocks
        }

        func appendSlice(_ slice: ArraySlice<HighlightRow>) async throws {
            // Flatten blocks for the batch (each highlight may produce multiple blocks)
            var children: [[String: Any]] = []
            for h in slice {
                let bs = buildBlocks(for: h)
                children.append(contentsOf: bs)
            }
            // Delegate robust append behavior to pageOperations.appendChildrenWithRetry
            try await pageOperations.appendChildrenWithRetry(pageId: pageId, children: children)
        }

        // 入口：按默认批次一批，逐批递归发送
        let batchSize = NotionSyncConfig.defaultAppendBatchSize
        var index = 0
        while index < highlights.count {
            let slice = highlights[index..<min(index + batchSize, highlights.count)]
            try await appendSlice(slice)
            index += batchSize
        }
    }

    func updateBlockContent(blockId: String, highlight: HighlightRow, bookId: String) async throws {
        // 构建 parent rich_text（highlight + uuid）并更新；父块类型与创建时一致：numbered_list_item
        let parentRt = helperMethods.buildParentRichText(for: highlight, bookId: bookId)
        _ = try await requestHelper.performRequest(path: "blocks/\(blockId)", method: "PATCH", body: ["numbered_list_item": ["rich_text": parentRt]])

        // 构建并替换子块（note + metadata+link）
        var childBlocks: [[String: Any]] = []
        if let noteChild = helperMethods.buildNoteChild(for: highlight) {
            childBlocks.append(noteChild)
        }
        childBlocks.append(helperMethods.buildMetaAndLinkChild(for: highlight, bookId: bookId))

        // 使用 pageOperations.replacePageChildren 来替换指定 block 的 children（适用于 block 的 children endpoint）
        try await pageOperations.replacePageChildren(pageId: blockId, with: childBlocks)
    }

    func createHighlightItem(inDatabaseId databaseId: String, bookId: String, bookTitle: String, author: String, highlight: HighlightRow) async throws -> NotionPage {
        let properties = helperMethods.buildHighlightProperties(bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight)
        let children = helperMethods.buildPerBookPageChildren(for: highlight, bookId: bookId)

        let body: [String: Any] = [
            "parent": [
                "type": "database_id",
                "database_id": databaseId
            ],
            "properties": properties,
            "children": children
        ]
        let data = try await requestHelper.performRequest(path: "pages", method: "POST", body: body)
        return try JSONDecoder().decode(NotionPage.self, from: data)
    }

    // New: Create a chunked highlight as a top-level block on an existing page (parentPageId)
    func createChunkedHighlightOnPage(parentPageId: String, bookId: String, highlight: HighlightRow) async throws {
        // 1) Split text into chunks
        let chunks = BlockSplitter.split(highlight.text)
        guard !chunks.isEmpty else { return }

        // 2) Build parent block from first chunk and append uuid marker so it's easy to find later
        let firstChunkWithUuid = chunks[0] + "\n[uuid:\(highlight.uuid)]"
        let parentRt = helperMethods.buildParentRichText(fromChunk: firstChunkWithUuid)
        let parentBlock: [String: Any] = [
            "object": "block",
            "numbered_list_item": [
                "rich_text": parentRt
            ]
        ]

        // Append parent block to page
        try await pageOperations.appendChildrenWithRetry(pageId: parentPageId, children: [parentBlock])

        // Fetch children and locate parent block by looking for uuid marker placed in the first chunk
        var parentBlockId: String? = nil
        do {
            var startCursor: String? = nil
            repeat {
                let url = requestHelper.makeURL(path: "blocks/\(parentPageId)/children")
                let data = try await requestHelper.performRequest(url: url, method: "GET", body: nil)
                let decoded = try JSONDecoder().decode(NotionQueryOperations.BlockChildrenResponse.self, from: data)
                for block in decoded.results {
                    // check parent block rich text for uuid marker
                    if let texts = block.paragraph?.rich_text ?? block.bulleted_list_item?.rich_text ?? block.numbered_list_item?.rich_text {
                        for t in texts {
                            if let s = t.plain_text, s.contains("[uuid:\(highlight.uuid)]") {
                                parentBlockId = block.id
                                break
                            }
                        }
                    }
                    if parentBlockId != nil { break }
                }
                startCursor = decoded.has_more ? decoded.next_cursor : nil
            } while startCursor != nil && parentBlockId == nil
        } catch {
            // ignore mapping failure; parentBlockId may remain nil
        }

        // 3) If we found parentBlockId, append remaining chunks as children of the parent
        if let pId = parentBlockId, chunks.count > 1 {
            var childBlocks: [[String: Any]] = []
            for idx in 1..<chunks.count {
                let chunkRt = helperMethods.buildParentRichText(fromChunk: chunks[idx])
                let paragraphBlock: [String: Any] = [
                    "object": "block",
                    "paragraph": ["rich_text": chunkRt]
                ]
                childBlocks.append(paragraphBlock)
            }
            try await pageOperations.appendChildrenWithRetry(pageId: pId, children: childBlocks)
        } else if chunks.count > 1 {
            // If we couldn't resolve parentBlockId, as fallback append remaining chunks as siblings to page
            var siblingBlocks: [[String: Any]] = []
            for idx in 1..<chunks.count {
                let chunkRt = helperMethods.buildParentRichText(fromChunk: chunks[idx])
                let paragraphBlock: [String: Any] = [
                    "object": "block",
                    "paragraph": ["rich_text": chunkRt]
                ]
                siblingBlocks.append(paragraphBlock)
            }
            try await pageOperations.appendChildrenWithRetry(pageId: parentPageId, children: siblingBlocks)
        }
    }

    func updateHighlightItem(pageId: String, bookId: String, bookTitle: String, author: String, highlight: HighlightRow) async throws {
        let properties = helperMethods.buildHighlightProperties(bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight, clearEmpty: true)
        _ = try await requestHelper.performRequest(path: "pages/\(pageId)", method: "PATCH", body: ["properties": properties])

        // Replace page children with up-to-date content
        let children = helperMethods.buildPerBookPageChildren(for: highlight, bookId: bookId)
        try await pageOperations.replacePageChildren(pageId: pageId, with: children)
    }
}
