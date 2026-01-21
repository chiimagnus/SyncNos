import SwiftUI

// MARK: - Help Commands
struct HelpCommands: Commands {
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        // Help 菜单 - 帮助相关
        CommandGroup(replacing: .help) {
            Button(String(localized: "Please give five stars", table: "Common"), systemImage: "heart") {
                openAppStoreReview()
            }

            Button(String(localized: "Report Issues & Suggestions", table: "Common"), systemImage: "ladybug") {
                openGitHubRepo()
            }

            Button(String(localized: "View Source Code", table: "Common"), systemImage: "link") {
                openGitHubSource()
            }

            Divider()

            Button(String(localized: "Show Logs", table: "Common"), systemImage: "doc.text.magnifyingglass") {
                openWindow(id: "log")
            }
            .keyboardShortcut("l", modifiers: [.command, .shift])
        }
    }

    private func openAppStoreReview() {
        let appStoreID = "6755133888"
        let appStoreURL = URL(string: "macappstore://apps.apple.com/app/id\(appStoreID)")!
        let webURL = URL(string: "https://apps.apple.com/app/id\(appStoreID)")!

        // 尝试打开 App Store 应用，如果失败则打开网页版本
        if !NSWorkspace.shared.open(appStoreURL) {
            NSWorkspace.shared.open(webURL)
        }
    }

    private func openGitHubRepo() {
        let githubURL = URL(string: "https://github.com/chiimagnus/SyncNos/issues")!
        NSWorkspace.shared.open(githubURL)
    }

    private func openGitHubSource() {
        let githubURL = URL(string: "https://github.com/chiimagnus/SyncNos")!
        NSWorkspace.shared.open(githubURL)
    }
}
