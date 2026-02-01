import SwiftUI

// 将应用菜单命令抽取到单独文件，便于维护与测试
struct AppCommands: Commands {
    @Environment(\.openWindow) private var openWindow

    private var appName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "SyncNos"
    }

    init() {
        // 禁用自动窗口标签，从而隐藏 "Show Tab" 和 "Show All Tabs" 菜单项
        NSWindow.allowsAutomaticWindowTabbing = false

        // 确保系统中任何绑定到 toggleSidebar 的菜单项都使用我们想要的快捷键（Cmd+\）
        DispatchQueue.main.async {
            let selector = #selector(NSSplitViewController.toggleSidebar(_:))
            guard let mainMenu = NSApp.mainMenu else { return }

            func normalize(menu: NSMenu) {
                for item in menu.items {
                    if item.action == selector {
                        item.keyEquivalent = "\\"
                        item.keyEquivalentModifierMask = [.command]
                    }
                    if let submenu = item.submenu {
                        normalize(menu: submenu)
                    }
                }
            }

            normalize(menu: mainMenu)
        }
    }

    var body: some Commands {
        // 还原系统自带的 About 菜单入口（文案保持系统风格），但把目的地改为 Settings → About
        CommandGroup(replacing: .appInfo) {
            Button("About \(appName)") {
                UserDefaults.standard.set("about", forKey: "syncnos.settings.pendingDestination")
                openWindow(id: "setting")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                    NotificationCenter.default.post(name: .navigateToAbout, object: nil)
                }
            }
        }

        // SyncNos 应用菜单 - 应用设置相关
        CommandGroup(replacing: .appSettings) {
            Button("Settings", systemImage: "gear") {
                openWindow(id: "setting")
            }
            .keyboardShortcut(",", modifiers: .command)
        }

        // File 菜单 - 文件操作相关
        FileCommands()

        // Edit 菜单 - 编辑操作相关
        EditCommands()

        // View 菜单 - 视图相关
        ViewCommands()

        // Window 菜单 - 窗口管理相关
        WindowCommands()

        // Help 菜单 - 帮助相关
        HelpCommands()
    }
}
