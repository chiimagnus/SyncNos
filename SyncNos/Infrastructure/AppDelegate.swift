import AppKit
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
        alert.messageText = String(localized: "quit.confirm.title", table: "Localizable-2")
        alert.addButton(withTitle: String(localized: "quit.button.cancel", table: "Localizable-2")) // 默认按钮：不退出
        alert.addButton(withTitle: String(localized: "quit.button.quit", table: "Localizable-2"))

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
}
