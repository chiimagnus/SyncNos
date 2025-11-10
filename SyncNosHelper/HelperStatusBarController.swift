import AppKit
import Combine

final class HelperStatusBarController {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var cancellables = Set<AnyCancellable>()
    private let logger = DIContainer.shared.loggerService

    // Dynamic items
    private let runningItem = NSMenuItem(title: "Running: 0", action: nil, keyEquivalent: "")
    private let appleSyncNowItem = NSMenuItem(title: "Sync Apple Books Now", action: #selector(syncAppleBooksNow), keyEquivalent: "")
    private let goodLinksSyncNowItem = NSMenuItem(title: "Sync GoodLinks Now", action: #selector(syncGoodLinksNow), keyEquivalent: "")
    private let openMainAppItem = NSMenuItem(title: "Open SyncNos", action: #selector(openMainApp), keyEquivalent: "")
    private let quitItem = NSMenuItem(title: "Quit Helper", action: #selector(quitHelper), keyEquivalent: "q")
    private let toggleAppleItem = NSMenuItem(title: "Auto Sync Apple Books", action: #selector(toggleAppleAutoSync), keyEquivalent: "")
    private let toggleGoodLinksItem = NSMenuItem(title: "Auto Sync GoodLinks", action: #selector(toggleGoodLinksAutoSync), keyEquivalent: "")

    init() {
        logger.info("HelperStatusBarController init started")

        // 检查状态栏按钮是否可用
        guard let button = statusItem.button else {
            logger.error("Failed to get status bar button - statusItem.button is nil")
            rebuildMenu()
            subscribeQueue()
            refreshToggleStates()
            return
        }

        logger.info("Status bar button created successfully")

        // 尝试加载 AppIcon
        if let img = NSImage(named: "AppIcon") {
            logger.info("AppIcon loaded successfully, size: \(img.size.width)x\(img.size.height)")

            // 使用状态栏高度作为目标尺寸（线稿图已自带内边距）
            let thickness = NSStatusBar.system.thickness
            let targetSize = NSSize(width: thickness, height: thickness)
            logger.info("Resizing icon to status bar thickness: \(thickness)px")

            let resized = NSImage(size: targetSize)
            resized.lockFocus()
            NSGraphicsContext.current?.imageInterpolation = .high
            img.draw(in: NSRect(origin: .zero, size: targetSize),
                     from: NSRect(origin: .zero, size: img.size),
                     operation: .sourceOver,
                     fraction: 1.0)
            resized.unlockFocus()

            // 保持彩色显示；如需系统模板渲染，可改为 true
            resized.isTemplate = true
            button.image = resized
            logger.info("Status bar icon set successfully (template mode: true)")
        } else {
            logger.warning("AppIcon not found, falling back to SF Symbol")
            // 降级方案：使用 SF Symbols
            if let symbolImage = NSImage(systemSymbolName: "arrow.triangle.2.circlepath", accessibilityDescription: "SyncNos Helper") {
                symbolImage.isTemplate = true
                button.image = symbolImage
                logger.info("Fallback SF Symbol icon set successfully")
            } else {
                logger.error("Failed to load both AppIcon and fallback SF Symbol")
            }
        }

        // 验证状态栏可见性
        logger.info("Status bar item visible: \(statusItem.isVisible)")

        rebuildMenu()
        subscribeQueue()
        refreshToggleStates()

        logger.info("HelperStatusBarController init completed")
    }
    
    private func subscribeQueue() {
        DIContainer.shared.syncQueueStore.tasksPublisher
            .sink { [weak self] tasks in
                let running = tasks.filter { $0.state == .running }.count
                self?.runningItem.title = "Running: \(running)"
            }
            .store(in: &cancellables)
    }
    
    private func rebuildMenu() {
        let menu = NSMenu()
        menu.addItem(runningItem)
        menu.addItem(NSMenuItem.separator())
        appleSyncNowItem.target = self
        goodLinksSyncNowItem.target = self
        openMainAppItem.target = self
        quitItem.target = self
        toggleAppleItem.target = self
        toggleGoodLinksItem.target = self
        
        menu.addItem(appleSyncNowItem)
        menu.addItem(goodLinksSyncNowItem)
        menu.addItem(NSMenuItem.separator())
        menu.addItem(toggleAppleItem)
        menu.addItem(toggleGoodLinksItem)
        menu.addItem(NSMenuItem.separator())
        menu.addItem(openMainAppItem)
        menu.addItem(quitItem)
        statusItem.menu = menu
    }
    
    private func refreshToggleStates() {
        toggleAppleItem.state = SharedDefaults.userDefaults.bool(forKey: "autoSync.appleBooks") ? .on : .off
        toggleGoodLinksItem.state = SharedDefaults.userDefaults.bool(forKey: "autoSync.goodLinks") ? .on : .off
    }
    
    @objc private func syncAppleBooksNow() {
        DIContainer.shared.autoSyncService.triggerAppleBooksNow()
    }
    
    @objc private func syncGoodLinksNow() {
        DIContainer.shared.autoSyncService.triggerGoodLinksNow()
    }
    
    @objc private func toggleAppleAutoSync() {
        let current = SharedDefaults.userDefaults.bool(forKey: "autoSync.appleBooks")
        SharedDefaults.userDefaults.set(!current, forKey: "autoSync.appleBooks")
        refreshToggleStates()
    }
    
    @objc private func toggleGoodLinksAutoSync() {
        let current = SharedDefaults.userDefaults.bool(forKey: "autoSync.goodLinks")
        SharedDefaults.userDefaults.set(!current, forKey: "autoSync.goodLinks")
        refreshToggleStates()
    }
    
    @objc private func openMainApp() {
        // Helper.app -> LoginItems -> Library -> Contents -> SyncNos.app
        var url = Bundle.main.bundleURL
        url.deleteLastPathComponent() // LoginItems
        url.deleteLastPathComponent() // Library
        url.deleteLastPathComponent() // Contents
        // now points to SyncNos.app
        let config = NSWorkspace.OpenConfiguration()
        config.activates = true
        NSWorkspace.shared.openApplication(at: url, configuration: config, completionHandler: nil)
    }
    
    @objc private func quitHelper() {
        NSApp.terminate(nil)
    }
}


