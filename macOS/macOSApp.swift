import SwiftUI

@main
struct macOSApp: App {
    init() {
        // Try auto-restore bookmark at launch
        if let url = BookmarkStore.shared.restore() {
            let started = BookmarkStore.shared.startAccessing(url: url)
            AppLogger.shared.info("Restored bookmark: \(url.path), startAccess=\(started)")
        } else {
            AppLogger.shared.info("No saved bookmark to restore")
        }
    }
    var body: some Scene {
        WindowGroup {
            BooksListView()
        }
    }
}