import SwiftUI

// MARK: - File Commands
struct FileCommands: Commands {
    var body: some Commands {
        // File 菜单 - 文件操作相关
        CommandGroup(after: .newItem) {
            Button("Sync Selected to Notion", systemImage: "arrow.triangle.2.circlepath.circle") {
                NotificationCenter.default.post(name: Notification.Name("SyncSelectedToNotionRequested"), object: nil)
            }
            .keyboardShortcut("s", modifiers: [.command, .option])
        }
    }
}
