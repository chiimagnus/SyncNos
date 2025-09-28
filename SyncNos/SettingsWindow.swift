import SwiftUI
import AppKit

/// Helper to present `SettingsView` in a standalone `NSWindow` (kept alive) so we don't rely on the `Settings` scene.
final class SettingsWindow {
    private static var window: NSWindow?

    static func show() {
        if let existing = window {
            existing.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let hosting = NSHostingController(rootView: SettingsView())
        let w = NSWindow(contentViewController: hosting)
        w.title = "Settings"
        // 使用与主窗口一致的外观：透明标题栏、隐藏标题文本，并启用全尺寸内容视图
        w.styleMask = [.titled, .closable, .resizable, .miniaturizable, .fullSizeContentView]
        w.titlebarAppearsTransparent = true
        // w.titleVisibility = .hidden
        w.setContentSize(NSSize(width: 375, height: 520))

        // 在 macOS 13+ 可以尝试设置 toolbar 样式与基线分隔线
        // 尝试将 toolbar 风格设置为与主窗口一致的 unified 风格
        w.toolbarStyle = .unified
        // 隐藏工具栏下方的基线分隔线（如果 toolbar 存在）
        w.toolbar?.showsBaselineSeparator = false
        // Keep the window retained after close until we explicitly clear it
        w.isReleasedWhenClosed = false

        // Clear our reference when window is closed
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: w, queue: .main) { _ in
            window = nil
        }

        window = w
        w.center()
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}
