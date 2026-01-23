import Foundation

// MARK: - Site Login Status

/// 站点登录状态（统一 cookieHeader 载体）
enum SiteLoginStatus: Sendable, Equatable {
    case unknown
    case valid
    case expired(reason: String)
    case needLogin(reason: String)
    case needVerification(reason: String)
    
    var isLoggedIn: Bool {
        switch self {
        case .valid:
            return true
        case .unknown, .expired, .needLogin, .needVerification:
            return false
        }
    }
    
    var summaryText: String {
        switch self {
        case .unknown:
            return "Unknown"
        case .valid:
            return "Valid"
        case .expired(let reason):
            return "Expired: \(reason)"
        case .needLogin(let reason):
            return "Need Login: \(reason)"
        case .needVerification(let reason):
            return "Need Verification: \(reason)"
        }
    }
}

// MARK: - Site Login Entry

/// 一个登录项：WeRead/Dedao（单项）+ GoodLinks（按 domain 多项）
struct SiteLoginEntry: Identifiable, Sendable, Equatable {
    let id: String
    let source: ContentSource
    let displayName: String
    let domain: String?
    let status: SiteLoginStatus
    let cookieHeader: String?
    let updatedAt: Date?
    
    var isLoggedIn: Bool {
        if let cookieHeader, !cookieHeader.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return status == .unknown ? true : status.isLoggedIn
        }
        return false
    }
    
    init(
        id: String? = nil,
        source: ContentSource,
        displayName: String? = nil,
        domain: String? = nil,
        status: SiteLoginStatus,
        cookieHeader: String? = nil,
        updatedAt: Date? = nil
    ) {
        let normalizedDomain = domain?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
        let computedId = id ?? {
            if let normalizedDomain, !normalizedDomain.isEmpty {
                return "\(source.rawValue):\(normalizedDomain)"
            }
            return "\(source.rawValue)"
        }()
        
        self.id = computedId
        self.source = source
        self.displayName = displayName ?? source.displayName
        self.domain = normalizedDomain
        self.status = status
        self.cookieHeader = cookieHeader?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.updatedAt = updatedAt
    }
}

