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
    }
}

// A small router to host BooksListView and present Settings when requested
struct ContentViewRouter: View {
    @State private var showSettings = false

    var body: some View {
        BooksListView()
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("ShowSettings"))) { _ in
                showSettings = true
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
    }
}