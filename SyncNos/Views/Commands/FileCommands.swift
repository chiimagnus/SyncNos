import SwiftUI

// MARK: - File Commands
struct FileCommands: Commands {
    var body: some Commands {
        // File 菜单 - 文件操作相关
        CommandGroup(replacing: .newItem) {
            Button(String(localized: "Refresh", table: "Common"), systemImage: "arrow.clockwise") {
                NotificationCenter.default.post(name: .refreshBooksRequested, object: nil)
            }
            .keyboardShortcut("r", modifiers: .command)

            Button(String(localized: "Sync Selected to Notion", table: "Common"), systemImage: "arrow.trianglehead.2.clockwise.rotate.90") {
                NotificationCenter.default.post(name: .syncSelectedToNotionRequested, object: nil)
            }
            .keyboardShortcut("s", modifiers: [.command, .option])
            
            Divider()
            
            Button(String(localized: "Full Resync Selected", table: "Common"), systemImage: "arrow.counterclockwise.circle") {
                NotificationCenter.default.post(name: .fullResyncSelectedRequested, object: nil)
            }
        }
    }
}
