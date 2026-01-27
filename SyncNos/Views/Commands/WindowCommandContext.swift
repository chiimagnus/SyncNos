import SwiftUI

// MARK: - Window/Scene Command Context
// 用 FocusedSceneValue 模拟 VSCode 的 "when" 条件：按当前活跃窗口上下文启用/禁用快捷键。

private struct MainWindowSceneActiveFocusedKey: FocusedValueKey {
    typealias Value = Bool
}

private struct GlobalSearchPresentedFocusedKey: FocusedValueKey {
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
}

