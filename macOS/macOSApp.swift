import SwiftUI

@main
struct macOSApp: App {
    init() {
        // Try auto-restore bookmark at launch
        if let url = BookmarkStore.shared.restore() {
            let started = BookmarkStore.shared.startAccessing(url: url)
            print("Restored bookmark: \(url.path), startAccess=\(started)")
        } else {
            print("No saved bookmark to restore")
        }
    }
    var body: some Scene {
        WindowGroup {
            ContentViewRouter()
        }

        // New separate window group for Settings so we can open it in its own window
        WindowGroup("Settings", id: "settingsview") {
            NavigationView {
                SettingsView()
            }
        }
    }
}

// A small router to host BooksListView and present Settings when requested
struct ContentViewRouter: View {
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        BooksListView()
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("ShowSettings"))) { _ in
                // Open the settings in a separate window group identified by "settingsview"
                openWindow(id: "settingsview")
            }
    }
}
