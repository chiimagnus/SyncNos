import Foundation

// MARK: - Web Article Models

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

import Foundation

// MARK: - Web Article Models

/// 网页文章抓取来源
enum WebArticleFetchSource: String, Codable, Sendable {
    case url            // 从 URL 直接获取（无需登录）
    case urlWithAuth    // 从 URL 获取（需要登录）
}

/// 网页文章抓取结果
struct WebArticle: Codable, Equatable, Sendable {
    let title: String?
    /// 原始抓取内容（当前实现为 HTML 片段）
    let contentHTML: String
    /// 纯文本内容（用于搜索与 Notion 同步）
    let textContent: String
    let author: String?
    let publishedDate: Date?
    let wordCount: Int
    let fetchedAt: Date
    let source: WebArticleFetchSource
}

/// 网页抓取错误
enum WebArticleFetchError: LocalizedError, Sendable {
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

