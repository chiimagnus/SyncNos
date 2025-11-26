import Foundation
import SwiftUI

// MARK: - DataSource 模型

/// 数据源模型 - 替代原有的 ContentSource
/// 用于侧边栏滑动切换的数据源表示
@MainActor
@Observable
public final class DataSource: Identifiable, Hashable {
    public let id: UUID
    public let type: DataSourceType
    var name: String
    var icon: String
    var isEnabled: Bool
    
    init(
        id: UUID = UUID(),
        type: DataSourceType,
        name: String,
        icon: String,
        isEnabled: Bool = true
    ) {
        self.id = id
        self.type = type
        self.name = name
        self.icon = icon
        self.isEnabled = isEnabled
    }
    
    // MARK: - Hashable
    
    public static func == (lhs: DataSource, rhs: DataSource) -> Bool {
        lhs.id == rhs.id
    }
    
    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

// MARK: - DataSourceType 枚举

/// 数据源类型枚举
public enum DataSourceType: String, Codable, CaseIterable, Hashable {
    case appleBooks = "appleBooks"
    case goodLinks = "goodLinks"
    case weRead = "weRead"
    
    /// 显示标题
    var title: String {
        switch self {
        case .appleBooks: return "Apple Books"
        case .goodLinks: return "GoodLinks"
        case .weRead: return "WeRead"
        }
    }
    
    /// 默认图标
    var defaultIcon: String {
        switch self {
        case .appleBooks: return "books.vertical.fill"
        case .goodLinks: return "link"
        case .weRead: return "text.book.closed.fill"
        }
    }
    
    /// 强调色
    var accentColor: Color {
        switch self {
        case .appleBooks: return .orange
        case .goodLinks: return .blue
        case .weRead: return .green
        }
    }
    
    /// UserDefaults 启用状态键
    var enabledKey: String {
        "datasource.\(rawValue).enabled"
    }
    
    /// 创建默认的 DataSource 实例
    @MainActor
    func createDataSource(isEnabled: Bool = true) -> DataSource {
        DataSource(
            type: self,
            name: title,
            icon: defaultIcon,
            isEnabled: isEnabled
        )
    }
}

// MARK: - DataSource 工厂方法

extension DataSource {
    /// 从 UserDefaults 创建所有数据源
    @MainActor
    static func createAllFromUserDefaults() -> [DataSource] {
        DataSourceType.allCases.map { type in
            let isEnabled = UserDefaults.standard.bool(forKey: type.enabledKey)
            return type.createDataSource(isEnabled: isEnabled)
        }
    }
    
    /// 获取已启用的数据源
    static func enabledSources(from sources: [DataSource]) -> [DataSource] {
        sources.filter { $0.isEnabled }
    }
}

