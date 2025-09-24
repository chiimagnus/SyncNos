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
        w.styleMask = [.titled, .closable, .resizable, .miniaturizable]
        w.setContentSize(NSSize(width: 375, height: 520))
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
