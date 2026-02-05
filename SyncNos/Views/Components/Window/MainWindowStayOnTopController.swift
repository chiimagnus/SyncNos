import AppKit
import Foundation

// MARK: - Main Window Stay On Top Controller

/// 只负责“主窗口置顶”状态管理：
/// - 不持久化（仅本次运行有效）
/// - 窗口关闭（⌘W）后自动恢复为不置顶
final class MainWindowStayOnTopController: ObservableObject {
    @Published private(set) var isEnabled: Bool = false

    private weak var window: NSWindow?
    private var windowWillCloseObserver: Any?

    deinit {
        detachWindow()
    }

    func attachWindow(_ newWindow: NSWindow?) {
        assertMainThread()
        if window === newWindow { return }

        detachWindow()
        window = newWindow

        guard let newWindow else { return }

        applyStayOnTop(to: newWindow, enabled: isEnabled)

        windowWillCloseObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification,
            object: newWindow,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            self.applyStayOnTop(to: newWindow, enabled: false)
            self.isEnabled = false
        }
    }

    func setEnabled(_ enabled: Bool) {
        assertMainThread()
        isEnabled = enabled
        if let window {
            applyStayOnTop(to: window, enabled: enabled)
        }
    }

    func reset() {
        assertMainThread()
        setEnabled(false)
        detachWindow()
    }

    private func detachWindow() {
        if let observer = windowWillCloseObserver {
            NotificationCenter.default.removeObserver(observer)
            windowWillCloseObserver = nil
        }
        window = nil
    }

    private func applyStayOnTop(to window: NSWindow, enabled: Bool) {
        assertMainThread()
        window.level = enabled ? .floating : .normal
    }

    private func assertMainThread() {
        precondition(Thread.isMainThread, "MainWindowStayOnTopController 必须在主线程使用")
    }
}
