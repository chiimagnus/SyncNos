import Foundation

// MARK: - Detail Scroll Target

/// 详情页需要滚动定位的目标（首版先占位，P4 接入各 DetailView）
struct DetailScrollTarget: Sendable, Equatable {
    let source: ContentSource
    let containerId: String
    let blockId: String?
    let kind: GlobalSearchResultKind
}

