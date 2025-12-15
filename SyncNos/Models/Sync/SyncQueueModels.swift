import Foundation
import SwiftUI

enum SyncSource: String, Codable, CaseIterable, Sendable {
    case appleBooks
    case goodLinks
    case weRead
    case dedao
    
    /// 显示名称
    var displayName: String {
        switch self {
        case .appleBooks: return "Apple Books"
        case .goodLinks: return "GoodLinks"
        case .weRead: return "WeRead"
        case .dedao: return "Dedao"
        }
    }
    
    /// SF Symbol 图标
    var iconName: String {
        switch self {
        case .appleBooks: return "book"
        case .goodLinks: return "bookmark"
        case .weRead: return "w.square"
        case .dedao: return "d.square"
        }
    }
    
    /// 品牌颜色
    var brandColor: Color {
        switch self {
        case .appleBooks: return Color("BrandAppleBooks")
        case .goodLinks: return Color("BrandGoodLinks")
        case .weRead: return Color("BrandWeRead")
        case .dedao: return Color("BrandDedao")
        }
    }
    
    /// 品牌颜色背景透明度
    var brandBackgroundOpacity: Double {
        switch self {
        case .appleBooks: return 0.18
        case .goodLinks: return 0.12
        case .weRead: return 0.14
        case .dedao: return 0.14
        }
    }
}  

enum SyncTaskState: String, Codable, Sendable {
    case queued
    case running
    case succeeded
    case failed
    case cancelled
}

// MARK: - Sync Error Type

/// 同步错误类型分类，用于 UI 展示和重试决策
enum SyncErrorType: String, Codable, Sendable {
    /// 网络错误（可重试）
    case network
    /// Notion API 限流（可重试，需等待）
    case rateLimited
    /// Notion 配置缺失（不可重试，需用户操作）
    case notionConfigMissing
    /// 认证失败（不可重试，需重新登录）
    case authenticationFailed
    /// 数据源不可用（如数据库未选择）
    case dataSourceUnavailable
    /// 未知错误
    case unknown
    
    /// 是否可自动重试
    var isRetryable: Bool {
        switch self {
        case .network, .rateLimited, .unknown:
            return true
        case .notionConfigMissing, .authenticationFailed, .dataSourceUnavailable:
            return false
        }
    }
    
    /// 错误类型对应的 SF Symbol 图标
    var iconName: String {
        switch self {
        case .network:
            return "wifi.slash"
        case .rateLimited:
            return "clock.badge.exclamationmark"
        case .notionConfigMissing:
            return "gear.badge.xmark"
        case .authenticationFailed:
            return "person.badge.key"
        case .dataSourceUnavailable:
            return "externaldrive.badge.xmark"
        case .unknown:
            return "exclamationmark.triangle"
        }
    }
}

/// 同步任务入队项（用于 SyncQueueStore.enqueue）
struct SyncEnqueueItem: Sendable {
    let id: String
    let title: String
    let subtitle: String?
    
    init(id: String, title: String, subtitle: String? = nil) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
    }
}

struct SyncQueueTask: Identifiable, Equatable, Sendable {
    let id: String
    let rawId: String
    let source: SyncSource
    var title: String
    var subtitle: String?
    var state: SyncTaskState
    var progressText: String?
    
    // MARK: - 错误信息（仅在 state == .failed 时有效）
    
    /// 错误类型
    var errorType: SyncErrorType?
    /// 错误简要描述（用于 UI 显示）
    var errorMessage: String?
    /// 详细错误信息（用于展开查看）
    var errorDetails: String?

    init(
        rawId: String,
        source: SyncSource,
        title: String,
        subtitle: String?,
        state: SyncTaskState = .queued,
        progressText: String? = nil,
        errorType: SyncErrorType? = nil,
        errorMessage: String? = nil,
        errorDetails: String? = nil
    ) {
        self.rawId = rawId
        self.source = source
        self.title = title
        self.subtitle = subtitle
        self.state = state
        self.progressText = progressText
        self.errorType = errorType
        self.errorMessage = errorMessage
        self.errorDetails = errorDetails
        self.id = "\(source.rawValue):\(rawId)"
    }
}

// MARK: - Sync Error Info

/// 同步错误信息（用于通知传递）
struct SyncErrorInfo: Sendable {
    let type: SyncErrorType
    let message: String
    let details: String?
    
    init(type: SyncErrorType, message: String, details: String? = nil) {
        self.type = type
        self.message = message
        self.details = details
    }
    
    /// 从 Error 创建 SyncErrorInfo
    static func from(_ error: Error) -> SyncErrorInfo {
        let nsError = error as NSError
        
        // 检测网络错误
        if nsError.domain == NSURLErrorDomain {
            return SyncErrorInfo(
                type: .network,
                message: NSLocalizedString("Network connection failed", comment: ""),
                details: error.localizedDescription
            )
        }
        
        // 检测 Notion API 限流（HTTP 429）
        if nsError.domain == "NotionAPI" && nsError.code == 429 {
            return SyncErrorInfo(
                type: .rateLimited,
                message: NSLocalizedString("Notion API rate limited", comment: ""),
                details: error.localizedDescription
            )
        }
        
        // 检测配置缺失
        let desc = error.localizedDescription.lowercased()
        if desc.contains("notion") && (desc.contains("config") || desc.contains("token") || desc.contains("page_id")) {
            return SyncErrorInfo(
                type: .notionConfigMissing,
                message: NSLocalizedString("Notion not configured", comment: ""),
                details: error.localizedDescription
            )
        }
        
        // 检测认证失败
        if desc.contains("unauthorized") || desc.contains("authentication") || desc.contains("401") {
            return SyncErrorInfo(
                type: .authenticationFailed,
                message: NSLocalizedString("Authentication failed", comment: ""),
                details: error.localizedDescription
            )
        }
        
        // 默认未知错误
        return SyncErrorInfo(
            type: .unknown,
            message: error.localizedDescription,
            details: nil
        )
    }
}
