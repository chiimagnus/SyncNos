import AppKit

/// 负责管理“菜单栏工具型 App”的 Dock 显示行为：
/// - 当用户设置为 `.menuBarOnly` 时：默认隐藏 Dock，但在主窗口展示期间临时显示 Dock。
/// - 当用户设置为 `.dockOnly` / `.both` 时：Dock 始终显示，不做临时隐藏。
@MainActor
enum DockPresenceService {
    /// 在即将展示主窗口时调用：必要时显示 Dock，并激活应用。
    static func prepareForPresentingMainWindow() {
        let app = NSApplication.shared

        if AppIconDisplayMode.current == .menuBarOnly, app.activationPolicy() != .regular {
            app.setActivationPolicy(.regular)
        }

        app.activate(ignoringOtherApps: true)
    }

    /// 在主窗口关闭后调用：仅当当前模式允许隐藏 Dock，且此时没有其它可见窗口时才隐藏。
    static func hideDockIfAllowedAfterMainWindowClosed() {
        hideDockIfAllowedWhenNoVisibleWindows()
    }

    /// 当窗口关闭导致“无可见窗口”时调用：仅在 `.menuBarOnly` 模式下隐藏 Dock。
    static func hideDockIfAllowedWhenNoVisibleWindows() {
        guard AppIconDisplayMode.current == .menuBarOnly else { return }

        let app = NSApplication.shared
        let hasVisibleWindows = app.windows.contains(where: { $0.isVisible && $0.canBecomeMain })

        guard !hasVisibleWindows else { return }
        guard app.activationPolicy() != .accessory else { return }

        app.setActivationPolicy(.accessory)
    }
}
