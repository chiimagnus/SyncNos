import AppKit
import Foundation

/// 主窗口 Dock 可见性控制器（仅作用于主窗口）。
///
/// 目标：当用户选择「仅菜单栏」模式时，打开主窗口期间临时显示 Dock，关闭主窗口后恢复隐藏。
public final class MainWindowDockVisibilityController {
    private weak var window: NSWindow?
    private var didBecomeMainObserver: Any?
    private var windowWillCloseObserver: Any?

    public init() {}

    deinit {
        detachWindow()
    }

    public func attachWindow(_ newWindow: NSWindow?) {
        assertMainThread()
        if window === newWindow { return }

        detachWindow()
        window = newWindow

        guard let newWindow else { return }

        didBecomeMainObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.didBecomeMainNotification,
            object: newWindow,
            queue: .main
        ) { _ in
            Task { @MainActor in
                DockPresenceService.prepareForPresentingMainWindow()
            }
        }

        windowWillCloseObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification,
            object: newWindow,
            queue: .main
        ) { _ in
            DispatchQueue.main.async {
                Task { @MainActor in
                    DockPresenceService.hideDockIfAllowedWhenNoVisibleWindows()
                }
            }
        }
    }

    public func reset() {
        assertMainThread()
        detachWindow()
    }

    private func detachWindow() {
        if let observer = didBecomeMainObserver {
            NotificationCenter.default.removeObserver(observer)
            didBecomeMainObserver = nil
        }
        if let observer = windowWillCloseObserver {
            NotificationCenter.default.removeObserver(observer)
            windowWillCloseObserver = nil
        }
        window = nil
    }

    private func assertMainThread() {
        precondition(Thread.isMainThread, "MainWindowDockVisibilityController 必须在主线程使用")
    }
}

