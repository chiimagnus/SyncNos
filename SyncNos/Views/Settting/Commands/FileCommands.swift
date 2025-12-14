import SwiftUI

// MARK: - File Commands
struct FileCommands: Commands {
    var body: some Commands {
        // File 菜单 - 文件操作相关
        CommandGroup(replacing: .newItem) {
            Button("Refresh", systemImage: "arrow.clockwise") {
                NotificationCenter.default.post(name: Notification.Name("RefreshBooksRequested"), object: nil)
            }
            .keyboardShortcut("r", modifiers: .command)

            Button("Sync Selected to Notion", systemImage: "arrow.triangle.2.circlepath.circle") {
                NotificationCenter.default.post(name: Notification.Name("SyncSelectedToNotionRequested"), object: nil)
            }
            .keyboardShortcut("s", modifiers: [.command, .option])
            
            Divider()
            
            Button("Full Resync Selected", systemImage: "arrow.counterclockwise.circle") {
                NotificationCenter.default.post(name: Notification.Name("FullResyncSelectedRequested"), object: nil)
            }
        }
    }
}
