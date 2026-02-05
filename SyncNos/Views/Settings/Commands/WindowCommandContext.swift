import SwiftUI

// MARK: - Window/Scene Command Context
// 用 FocusedSceneValue 模拟 VSCode 的 "when" 条件：按当前活跃窗口上下文启用/禁用快捷键。

private struct MainWindowSceneActiveFocusedKey: FocusedValueKey {
    typealias Value = Bool
}

private struct GlobalSearchPresentedFocusedKey: FocusedValueKey {
    typealias Value = Bool
}

private struct MainWindowEnabledDataSourcesFocusedKey: FocusedValueKey {
    typealias Value = [ContentSource]
}

private struct MainWindowStayOnTopEnabledFocusedKey: FocusedValueKey {
    typealias Value = Bool
}

extension FocusedValues {
    /// 当前 keyWindow 是否为主窗口（Window id: "main"）。
    var isMainWindowSceneActive: Bool? {
        get { self[MainWindowSceneActiveFocusedKey.self] }
        set { self[MainWindowSceneActiveFocusedKey.self] = newValue }
    }

    /// 主窗口内是否正在显示全局搜索面板（⌘K）。
    var isGlobalSearchPresented: Bool? {
        get { self[GlobalSearchPresentedFocusedKey.self] }
        set { self[GlobalSearchPresentedFocusedKey.self] = newValue }
    }
    
    /// 主窗口当前启用的数据源顺序（用于 Commands 中的 Cmd+1/2/... 映射）。
    var mainWindowEnabledDataSources: [ContentSource]? {
        get { self[MainWindowEnabledDataSourcesFocusedKey.self] }
        set { self[MainWindowEnabledDataSourcesFocusedKey.self] = newValue }
    }

    /// 主窗口是否启用置顶（用于 Window 菜单 Toggle 勾选状态）。
    var isMainWindowStayOnTopEnabled: Bool? {
        get { self[MainWindowStayOnTopEnabledFocusedKey.self] }
        set { self[MainWindowStayOnTopEnabledFocusedKey.self] = newValue }
    }
}
