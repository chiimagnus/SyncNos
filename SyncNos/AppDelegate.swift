import SwiftUI

@objc final class AppDelegate: NSObject, NSApplicationDelegate {
    private static var bypassNextTerminationOnce: Bool = false
    private var bypassObserver: NSObjectProtocol?

    override init() {
        super.init()
        bypassObserver = NotificationCenter.default.addObserver(forName: Notification.Name("BypassQuitConfirmationOnce"), object: nil, queue: .main) { _ in
            Self.bypassNextTerminationOnce = true
        }
    }

    deinit {
        if let token = bypassObserver { NotificationCenter.default.removeObserver(token) }
    }
    
    // MARK: - Application Launch
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        // 应用保存的图标显示模式设置（NSApp 此时已初始化）
        AppIconDisplayViewModel.applyStoredMode()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        // 若之前已在其它流程中确认过“退出”，则直接退出一次
        if Self.bypassNextTerminationOnce {
            Self.bypassNextTerminationOnce = false
            return .terminateNow
        }

        // 若没有同步在进行，则直接退出
        if !DIContainer.shared.syncActivityMonitor.isSyncing {
            return .terminateNow
        }

        presentQuitAlert()
        return .terminateLater
    }

    // MARK: - UI
    private func presentQuitAlert() {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = NSLocalizedString("Sync to Notion is in progress. Quit anyway?", comment: "")
        alert.addButton(withTitle: NSLocalizedString("Don't Quit", comment: "")) // 默认按钮：不退出
        alert.addButton(withTitle: NSLocalizedString("Quit", comment: ""))

        if let w = NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first {
            alert.beginSheetModal(for: w) { response in
                let shouldQuit = (response == .alertSecondButtonReturn)
                NSApp.reply(toApplicationShouldTerminate: shouldQuit)
            }
        } else {
            let response = alert.runModal()
            let shouldQuit = (response == .alertSecondButtonReturn)
            NSApp.reply(toApplicationShouldTerminate: shouldQuit)
        }
    }

    // Notification delegate methods removed.

    // Prevent AppKit from creating an untitled new window when app is activated
    func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool {
        return false
    }
    
    // Ensure clicking the Dock icon re-opens the main window even if other windows are visible.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        // Try to find the main window created by the SwiftUI `Window(id: "main")`
        if let mainWindow = sender.windows.first(where: { $0.identifier?.rawValue == "main" }) {
            mainWindow.makeKeyAndOrderFront(nil)
            sender.activate(ignoringOtherApps: true)
            return true
        }

        // Fallback: if no window has identifier "main", bring the first window to front.
        if let anyWindow = sender.windows.first {
            anyWindow.makeKeyAndOrderFront(nil)
            sender.activate(ignoringOtherApps: true)
        }
        return true
    }
    
    // MARK: - Application Lifecycle
    /// 应用从后台恢复时，刷新订阅状态
    func applicationDidBecomeActive(_ notification: Notification) {
        Task {
            await DIContainer.shared.iapService.refreshPurchasedStatus()
        }
    }
    
    // MARK: - URL Scheme Handling
    /// 处理自定义 URL scheme 回调（备用机制）
    /// 主要处理由 ASWebAuthenticationSession 负责，此方法作为备用
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            // 处理 syncnos://oauth/callback 回调
            if url.scheme == "syncnos" && url.host == "oauth" && url.path == "/callback" {
                DIContainer.shared.loggerService.info("Received OAuth callback via URL scheme: \(url.absoluteString)")
                // ASWebAuthenticationSession 会自动处理，这里只是记录日志
                // 如果需要手动处理，可以在这里添加逻辑
            }
        }
    }

}
