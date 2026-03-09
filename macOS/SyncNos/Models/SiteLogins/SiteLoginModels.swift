import Foundation

// MARK: - Site Logins Domain Entry

/// 统一存储（domain → cookieHeader）的一条记录
struct SiteLoginsDomainEntry: Identifiable, Sendable, Equatable {
    var id: String { domain }
    let domain: String
    let cookieHeader: String
    let updatedAt: Date
}
