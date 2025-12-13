//
//  WhatsNewModels.swift
//  SyncNos
//
//  Created by Chii on 2025/12/13.
//

import Foundation

// MARK: - 版本更新数据模型

/// 单个版本的更新数据
public struct WhatsNewVersion: Codable, Hashable, Identifiable, Sendable {
    public var id: String { version }
    
    /// 版本号（如 "0.9.5"）
    public let version: String
    
    /// 可选的子版本号
    public let subVersion: String?
    
    /// 该版本的更新项列表
    public let items: [WhatsNewItem]
    
    enum CodingKeys: String, CodingKey {
        case version, subVersion
        case items = "new"
    }
    
    public init(version: String, subVersion: String? = nil, items: [WhatsNewItem]) {
        self.version = version
        self.subVersion = subVersion
        self.items = items
    }
}

/// 单个更新项
public struct WhatsNewItem: Codable, Hashable, Identifiable, Sendable {
    public var id: String { "\(icon)_\(title)" }
    
    /// SF Symbol 图标名称
    public let icon: String
    
    /// 标题
    public let title: String
    
    /// 副标题
    public let subtitle: String
    
    /// 详细描述
    public let body: String
    
    public init(icon: String, title: String, subtitle: String, body: String) {
        self.icon = icon
        self.title = title
        self.subtitle = subtitle
        self.body = body
    }
}

// MARK: - 错误类型

enum WhatsNewError: LocalizedError {
    case fileNotFound
    case invalidURL
    case decodingFailed(Error)
    case networkError(Error)
    
    var errorDescription: String? {
        switch self {
        case .fileNotFound:
            return String(localized: "What's New data file not found")
        case .invalidURL:
            return String(localized: "Invalid data source URL")
        case .decodingFailed(let error):
            return String(localized: "Data parsing failed: \(error.localizedDescription)")
        case .networkError(let error):
            return String(localized: "Network request failed: \(error.localizedDescription)")
        }
    }
}

// MARK: - 数据源类型

/// What's New 数据源配置
enum WhatsNewDataSource: Sendable {
    /// 本地 Bundle 中的 JSON 文件
    case local(fileName: String)
    
    /// 远程 URL 的 JSON 数据
    case remote(url: String)
    
    /// 默认数据源（本地 datav001.json）
    static var `default`: WhatsNewDataSource {
        .local(fileName: "datav001")
    }
}

