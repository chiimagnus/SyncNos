import Foundation

/// 应用图标显示模式
/// 控制 SyncNos 图标在菜单栏和 Dock 中的显示方式
enum AppIconDisplayMode: Int, CaseIterable, Identifiable {
    /// 同时在菜单栏和 Dock 显示（默认）
    case both = 0
    /// 仅在菜单栏显示
    case menuBarOnly = 1
    /// 仅在 Dock 显示
    case dockOnly = 2
    
    var id: Int { rawValue }
    
    /// 用于 UI 显示的本地化名称
    var displayName: String {
        switch self {
        case .both:
            return String(localized: "In the Menu Bar and Dock", comment: "App icon display mode: both menu bar and dock")
        case .menuBarOnly:
            return String(localized: "In the Menu Bar", comment: "App icon display mode: menu bar only")
        case .dockOnly:
            return String(localized: "In the Dock", comment: "App icon display mode: dock only")
        }
    }
    
    /// UserDefaults 存储键
    static let userDefaultsKey = "appIconDisplayMode"
    
    /// 从 UserDefaults 加载当前设置，默认为 .both
    static var current: AppIconDisplayMode {
        get {
            let rawValue = UserDefaults.standard.integer(forKey: userDefaultsKey)
            return AppIconDisplayMode(rawValue: rawValue) ?? .both
        }
        set {
            UserDefaults.standard.set(newValue.rawValue, forKey: userDefaultsKey)
        }
    }
    
    /// 是否显示菜单栏图标
    var showsMenuBarIcon: Bool {
        self == .menuBarOnly || self == .both
    }
    
    /// 是否显示 Dock 图标
    var showsDockIcon: Bool {
        self == .dockOnly || self == .both
    }
}

