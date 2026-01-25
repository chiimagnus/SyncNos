import Foundation
import SwiftData

// MARK: - Web Article Cache Models

/// URL 网页文章抓取结果缓存模型（SwiftData）
///
/// 说明：
/// - 缓存用于避免每次打开都重新抓取网页文章内容
/// - 以 URL 作为唯一键（同一 URL 仅保留一份最新缓存）
@Model
final class CachedWebArticle {
    @Attribute(.unique) var url: String
    var title: String?
    var author: String?
    var contentHTML: String
    var textContent: String
    var wordCount: Int
    var fetchedAt: Date
    var cachedAt: Date

    init(
        url: String,
        title: String?,
        author: String?,
        contentHTML: String,
        textContent: String,
        wordCount: Int,
        fetchedAt: Date,
        cachedAt: Date
    ) {
        self.url = url
        self.title = title
        self.author = author
        self.contentHTML = contentHTML
        self.textContent = textContent
        self.wordCount = wordCount
        self.fetchedAt = fetchedAt
        self.cachedAt = cachedAt
    }
}

