import AppKit
import SwiftUI
import UserNotifications

@objc final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    private static var bypassNextTerminationOnce: Bool = false
    private var bypassObserver: NSObjectProtocol?

    override init() {
        super.init()
        bypassObserver = NotificationCenter.default.addObserver(forName: Notification.Name("BypassQuitConfirmationOnce"), object: nil, queue: .main) { _ in
            Self.bypassNextTerminationOnce = true
        }
        // Setup UNUserNotificationCenter delegate to present notifications while app is foreground
        if #available(macOS 10.14, *) {
            let center = UNUserNotificationCenter.current()
            center.delegate = self
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

    // MARK: - UNUserNotificationCenterDelegate
    @available(macOS 10.14, *)
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // Present banner + sound even when app is foreground
        completionHandler([.banner, .sound, .list])
    }

    @available(macOS 10.14, *)
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        // Handle notification tap: bring existing main window to front instead of creating a new one
        DispatchQueue.main.async {
            NSApp.activate(ignoringOtherApps: true)

            // If there's any visible window, bring it to front
            if let w = NSApp.windows.first(where: { $0.isVisible }) {
                w.makeKeyAndOrderFront(nil)
            } else if let w = NSApp.windows.first {
                // If no visible window, just bring first window to front
                w.makeKeyAndOrderFront(nil)
            }
        }

        completionHandler()
    }

    // Prevent AppKit from creating an untitled new window when app is activated
    func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool {
        return false
    }

}
