import Foundation

// MARK: - Global Search Models

/// 全局搜索范围：默认搜所有启用数据源，也支持仅搜某个数据源
enum GlobalSearchScope: Sendable, Equatable {
    case allEnabled
    case source(ContentSource)
}

/// 全局搜索结果类型
enum GlobalSearchResultKind: String, Sendable, Equatable {
    /// 命中具体内容块（高亮/笔记/消息/正文）
    case textBlock
    /// 仅命中条目元信息（标题/作者/URL/标签），无法定位到具体块
    case titleOnly
}

/// 选中全局搜索结果后的跳转目标（由 MainListView 统一处理切源/选中/定位）
struct GlobalSearchNavigationTarget: Sendable, Equatable {
    let source: ContentSource
    let containerId: String
    let blockId: String?
    let kind: GlobalSearchResultKind

    var userInfo: [String: Any] {
        var info: [String: Any] = [
            "source": source.rawValue,
            "containerId": containerId,
            "kind": kind.rawValue
        ]
        if let blockId {
            info["blockId"] = blockId
        }
        return info
    }

    static func fromUserInfo(_ userInfo: [AnyHashable: Any]) -> GlobalSearchNavigationTarget? {
        guard let sourceRaw = userInfo["source"] as? String,
              let source = ContentSource(rawValue: sourceRaw),
              let containerId = userInfo["containerId"] as? String,
              let kindRaw = userInfo["kind"] as? String,
              let kind = GlobalSearchResultKind(rawValue: kindRaw) else {
            return nil
        }
        let blockId = userInfo["blockId"] as? String
        return GlobalSearchNavigationTarget(source: source, containerId: containerId, blockId: blockId, kind: kind)
    }
}

/// 全局搜索结果（面板列表渲染用）
struct GlobalSearchResult: Identifiable, Sendable, Equatable {
    /// 唯一标识：source + containerId + blockId + kind
    let id: String
    let source: ContentSource
    let kind: GlobalSearchResultKind

    /// “条目”维度：书/文章/对话
    let containerId: String
    let containerTitle: String
    let containerSubtitle: String?

    /// “内容块”维度：高亮 id / 消息 id / 正文命中块 id（titleOnly 可能为空）
    let blockId: String?

    /// 面板展示用 snippet（纯文本）
    let snippet: String
    /// 命中范围（相对 snippet，UTF16 offset）
    let snippetMatchRangesUTF16: [Range<Int>]

    /// 用于同分排序的时间（高亮/消息时间；titleOnly 可用条目更新时间）
    let timestamp: Date?
    /// 相关度分数（越大越靠前）
    let score: Int

    var navigationTarget: GlobalSearchNavigationTarget {
        GlobalSearchNavigationTarget(
            source: source,
            containerId: containerId,
            blockId: blockId,
            kind: kind
        )
    }

    init(
        source: ContentSource,
        kind: GlobalSearchResultKind,
        containerId: String,
        containerTitle: String,
        containerSubtitle: String? = nil,
        blockId: String? = nil,
        snippet: String,
        snippetMatchRangesUTF16: [Range<Int>],
        timestamp: Date? = nil,
        score: Int
    ) {
        self.source = source
        self.kind = kind
        self.containerId = containerId
        self.containerTitle = containerTitle
        self.containerSubtitle = containerSubtitle
        self.blockId = blockId
        self.snippet = snippet
        self.snippetMatchRangesUTF16 = snippetMatchRangesUTF16
        self.timestamp = timestamp
        self.score = score

        let blockPart = blockId ?? ""
        self.id = "\(source.rawValue)|\(containerId)|\(blockPart)|\(kind.rawValue)"
    }
}
