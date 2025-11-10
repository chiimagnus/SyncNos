import AppKit
import Foundation

/// 状态栏控制器（位于 Helper 进程中，常驻）
final class StatusBarController: NSObject {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

    override init() {
        super.init()
        if let button = statusItem.button {
            // 尝试加载资源名为 SyncNosStatusIcon 的图标（如不存在则保留空）
            if let img = NSImage(named: "SyncNosStatusIcon") {
                img.isTemplate = true
                button.image = img
            }
            // button.action = #selector(menuClicked(_:))
            // button.target = self
        }
        statusItem.menu = buildMenu()
    }

    private func buildMenu() -> NSMenu {
        let menu = NSMenu()

        let syncAll = NSMenuItem(title: "立即全部同步", action: #selector(syncAll), keyEquivalent: "")
        syncAll.target = self
        menu.addItem(syncAll)

        let syncApple = NSMenuItem(title: "立即同步 Apple Books", action: #selector(syncAppleBooks), keyEquivalent: "")
        syncApple.target = self
        menu.addItem(syncApple)

        let syncGoodLinks = NSMenuItem(title: "立即同步 GoodLinks", action: #selector(syncGoodLinks), keyEquivalent: "")
        syncGoodLinks.target = self
        menu.addItem(syncGoodLinks)

        let toggleAuto = NSMenuItem(title: "切换自动同步", action: #selector(toggleAutoSync), keyEquivalent: "")
        toggleAuto.target = self
        menu.addItem(toggleAuto)

        menu.addItem(NSMenuItem.separator())

        let openMain = NSMenuItem(title: "打开主应用", action: #selector(openMainApp), keyEquivalent: "")
        openMain.target = self
        menu.addItem(openMain)

        let quit = NSMenuItem(title: "退出 Helper", action: #selector(quitHelper), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)

        return menu
    }

    // MARK: - Actions
    // @objc private func menuClicked(_ sender: Any?) {
    //     // 展示菜单由系统负责，保留空实现以满足 Selector 绑定
    // }

    @objc private func syncAll() {
        Task.detached(priority: .utility) {
            DIContainer.shared.autoSyncService.triggerSyncNow()
        }
    }

    @objc private func syncAppleBooks() {
        Task.detached(priority: .utility) {
            DIContainer.shared.autoSyncService.triggerAppleBooksNow()
        }
    }

    @objc private func syncGoodLinks() {
        Task.detached(priority: .utility) {
            DIContainer.shared.autoSyncService.triggerGoodLinksNow()
        }
    }

    @objc private func toggleAutoSync() {
        // 将两个来源的自动同步开关取反（简单切换策略）
        let appleKey = "autoSync.appleBooks"
        let goodKey = "autoSync.goodLinks"
        let appleNow = SharedDefaults.userDefaults.bool(forKey: appleKey)
        let goodNow = SharedDefaults.userDefaults.bool(forKey: goodKey)
        let newVal = !(appleNow || goodNow)
        SharedDefaults.userDefaults.set(newVal, forKey: appleKey)
        SharedDefaults.userDefaults.set(newVal, forKey: goodKey)
        // 通过日志记录变更
        DIContainer.shared.loggerService.info("StatusBarController: toggled autoSync to \(newVal)")
    }

    @objc private func openMainApp() {
        // 尝试从 Helper bundle 推断主应用路径：.../MainApp.app/Contents/Library/LoginItems/SyncNosHelper.app
        var candidate = Bundle.main.bundleURL
        // 从 SyncNosHelper.app 向上走 4 级以到达 MainApp.app
        for _ in 0..<4 { candidate.deleteLastPathComponent() }

        let fm = FileManager.default
        if fm.fileExists(atPath: candidate.path) {
            let config = NSWorkspace.OpenConfiguration()
            config.activates = true
            NSWorkspace.shared.openApplication(at: candidate, configuration: config, completionHandler: nil)
            DIContainer.shared.loggerService.info("StatusBarController: opened main app at \(candidate.path)")
            return
        }

        // 兜底尝试 /Applications/SyncNos.app
        let fallback = URL(fileURLWithPath: "/Applications/SyncNos.app", isDirectory: true)
        if fm.fileExists(atPath: fallback.path) {
            let config = NSWorkspace.OpenConfiguration()
            config.activates = true
            NSWorkspace.shared.openApplication(at: fallback, configuration: config, completionHandler: nil)
            DIContainer.shared.loggerService.info("StatusBarController: opened fallback main app at \(fallback.path)")
            return
        }

        DIContainer.shared.loggerService.warning("StatusBarController: failed to locate main app to open")
    }

    @objc private func quitHelper() {
        NSApp.terminate(nil)
    }
}


