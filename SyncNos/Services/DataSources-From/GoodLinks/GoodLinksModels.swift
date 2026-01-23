import Foundation

// MARK: - GoodLinks Models

struct GoodLinksLinkRow: Codable, Equatable {
    let id: String
    let url: String
    let originalURL: String?
    let title: String?
    let summary: String?
    let author: String?
    let tags: String?
    let starred: Bool
    let readAt: Double
    let addedAt: Double
    let modifiedAt: Double
    let highlightTotal: Int?

    // MARK: - Derived
    var tagsArray: [String] {
        GoodLinksTagParser.parseTagsString(tags)
    }

    var tagsFormatted: String {
        GoodLinksTagParser.formatTagsWithSemicolon(tags)
    }

    // Deeplink to open the link in GoodLinks app
    var openInGoodLinksURLString: String {
        "goodlinks://x-callback-url/open?id=\(id)"
    }
}

struct GoodLinksHighlightRow: Codable, Equatable {
    let id: String
    let linkId: String
    let content: String
    let color: Int?
    let note: String?
    let time: Double

    // Deeplink to open the specific highlight in GoodLinks app
    // The highlight id contains a '#' fragment which must be percent-encoded in query
    var openInGoodLinksHighlightURLString: String {
        let forbidden = CharacterSet(charactersIn: "&=?#")
        let allowed = CharacterSet.urlQueryAllowed.subtracting(forbidden)
        let encoded = id.addingPercentEncoding(withAllowedCharacters: allowed) ?? id
        return "goodlinks://x-callback-url/open-highlight?id=\(encoded)"
    }
}

struct GoodLinksLinkHighlightCount: Equatable {
    let linkId: String
    let count: Int
}

// MARK: - URL Article Fetching

/// 文章抓取来源
enum FetchSource: String, Codable, Sendable {
    case url            // 从 URL 直接获取（无需登录）
    case urlWithAuth    // 从 URL 获取（需要登录）
}

/// 文章抓取结果（URL Only）
struct ArticleFetchResult: Codable, Equatable, Sendable {
    let title: String?
    /// 原始抓取内容（当前实现为 HTML 片段）
    let content: String
    /// 纯文本内容（用于搜索与 Notion 同步）
    let textContent: String
    let author: String?
    let publishedDate: Date?
    let wordCount: Int
    let fetchedAt: Date
    let source: FetchSource
}

/// URL 抓取错误（URL Only）
enum URLFetchError: LocalizedError, Sendable {
    case invalidURL(String)
    case invalidResponse
    case httpStatus(Int)
    case authenticationRequired
    case rateLimited
    case decodingFailed
    case parsingFailed
    case contentNotFound
    case networkError(Error)
    
    var errorDescription: String? {
        switch self {
        case .invalidURL(let raw):
            return "Invalid URL: \(raw)"
        case .invalidResponse:
            return "Invalid HTTP response"
        case .httpStatus(let code):
            return "HTTP status code: \(code)"
        case .authenticationRequired:
            return "Authentication required"
        case .rateLimited:
            return "Rate limited"
        case .decodingFailed:
            return "Failed to decode response body"
        case .parsingFailed:
            return "Failed to parse article content"
        case .contentNotFound:
            return "No article content detected"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        }
    }
}

// MARK: - Sorting
enum GoodLinksSortKey: String, CaseIterable {
    case title = "title"
    case highlightCount = "highlightCount"
    case added = "added"
    case modified = "modified"
    case lastSync = "lastSync"

    var displayName: LocalizedStringResource {
        switch self {
        case .title: return "Title"
        case .highlightCount: return "Highlight Count"
        case .added: return "Added Time"
        case .modified: return "Modified Time"
        case .lastSync: return "Last Sync Time"
        }
    }
}
