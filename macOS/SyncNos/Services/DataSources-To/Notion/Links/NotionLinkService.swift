import AppKit
import Foundation

// MARK: - NotionLinkService

/// 负责从本地映射/Notion API 解析出页面/数据库，并按用户偏好打开（浏览器/Notion App）。
final class NotionLinkService: NotionLinkServiceProtocol {
    // MARK: - Dependencies

    private let notionConfig: NotionConfigStoreProtocol
    private let notionService: NotionClientProtocol
    private let logger: LoggerServiceProtocol

    // MARK: - Initialization

    init(
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        notionService: NotionClientProtocol = DIContainer.shared.notionClient,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.notionConfig = notionConfig
        self.notionService = notionService
        self.logger = logger
    }

    // MARK: - NotionLinkServiceProtocol

    func canOpenNotionTargetForItem(sourceKey: String, assetId: String) -> Bool {
        if shouldOpenPerBookDatabase(sourceKey: sourceKey) {
            return notionConfig.databaseIdForBook(assetId: assetId) != nil
        }

        if notionConfig.pageIdForItem(sourceKey: sourceKey, assetId: assetId) != nil {
            return true
        }

        // 没有本地 pageId 映射时，允许点击后再尝试用数据库 + Asset ID 去 Notion 查询 pageId
        return notionConfig.databaseIdForSource(sourceKey) != nil
    }

    @MainActor
    func openNotionTargetForItem(sourceKey: String, assetId: String) async {
        do {
            guard let target = try await resolveTargetForItem(sourceKey: sourceKey, assetId: assetId) else {
                showNotSyncedAlert()
                return
            }
            open(target: target)
        } catch {
            logger.error("[NotionLinkService] Resolve/open failed for \(sourceKey):\(assetId) - \(error.localizedDescription)")
            showOpenFailedAlert()
        }
    }

    // MARK: - Resolve

    private func resolveTargetForItem(sourceKey: String, assetId: String) async throws -> NotionLinkTarget? {
        // Apple Books + perBook：打开该书对应的 Notion Database
        if shouldOpenPerBookDatabase(sourceKey: sourceKey) {
            guard let dbId = notionConfig.databaseIdForBook(assetId: assetId), !dbId.isEmpty else {
                return nil
            }
            return .database(id: dbId)
        }

        // 默认：打开页面
        if let cached = notionConfig.pageIdForItem(sourceKey: sourceKey, assetId: assetId), !cached.isEmpty {
            return .page(id: cached)
        }

        // fallback：已知数据库 id 时可通过 Asset ID 查询页面
        guard let databaseId = notionConfig.databaseIdForSource(sourceKey), !databaseId.isEmpty else {
            return nil
        }

        if let pageId = try await notionService.findPageIdByAssetId(databaseId: databaseId, assetId: assetId) {
            notionConfig.setPageId(pageId, forItem: assetId, sourceKey: sourceKey)
            return .page(id: pageId)
        }

        return nil
    }

    private func shouldOpenPerBookDatabase(sourceKey: String) -> Bool {
        guard sourceKey == "appleBooks" else { return false }
        return (notionConfig.syncMode ?? NotionSyncStrategy.singleDatabase.rawValue) == NotionSyncStrategy.perBookDatabase.rawValue
    }

    // MARK: - Open

    @MainActor
    private func open(target: NotionLinkTarget) {
        guard let webURL = buildNotionWebURL(for: target) else {
            showOpenFailedAlert()
            return
        }

        if notionConfig.openNotionLinksInBrowser {
            // 说明：Notion.app 在 macOS 上可能通过 Universal Links “截获” https://www.notion.so/...，
            // 导致即使用户想在浏览器打开也会直接跳到 Notion.app。
            // 这里用 http:// 作为绕过入口，让系统先打开浏览器，再由浏览器重定向到 https。
            if let bypassURL = buildNotionBrowserBypassURL(for: target) {
                openInDefaultBrowser(url: bypassURL)
            } else {
                openInDefaultBrowser(url: webURL)
            }
            return
        }

        if let appURL = buildNotionAppURL(for: target) {
            let ok = NSWorkspace.shared.open(appURL)
            if !ok {
                openInDefaultBrowser(url: webURL)
            }
        } else {
            openInDefaultBrowser(url: webURL)
        }
    }

    private func buildNotionWebURL(for target: NotionLinkTarget) -> URL? {
        let id: String
        switch target {
        case .page(let pageId):
            id = pageId
        case .database(let databaseId):
            id = databaseId
        }
        let cleaned = id.replacingOccurrences(of: "-", with: "")
        guard !cleaned.isEmpty else { return nil }
        return URL(string: "https://www.notion.so/\(cleaned)")
    }

    /// 用于“强制在浏览器打开”的绕过 URL（避免被 Universal Links 直接拉起 Notion.app）
    private func buildNotionBrowserBypassURL(for target: NotionLinkTarget) -> URL? {
        let id: String
        switch target {
        case .page(let pageId):
            id = pageId
        case .database(let databaseId):
            id = databaseId
        }
        let cleaned = id.replacingOccurrences(of: "-", with: "")
        guard !cleaned.isEmpty else { return nil }
        return URL(string: "http://www.notion.so/\(cleaned)")
    }

    private func buildNotionAppURL(for target: NotionLinkTarget) -> URL? {
        let id: String
        switch target {
        case .page(let pageId):
            id = pageId
        case .database(let databaseId):
            id = databaseId
        }
        let cleaned = id.replacingOccurrences(of: "-", with: "")
        guard !cleaned.isEmpty else { return nil }
        // 说明：Notion App 是否支持该 scheme 与路径依赖安装版本；失败会回退浏览器。
        return URL(string: "notion://www.notion.so/\(cleaned)")
    }

    private func openInDefaultBrowser(url: URL) {
        // 用 NSWorkspace 获取 http/https 的默认打开应用（通常是默认浏览器）
        // 注意：这里“默认浏览器”指 URL scheme 的默认处理器，而不是 Universal Links 的目标 App。
        guard let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            _ = NSWorkspace.shared.open(url)
            return
        }

        guard let probeURL = URL(string: "\(scheme)://example.com") else {
            _ = NSWorkspace.shared.open(url)
            return
        }

        guard let appURL = NSWorkspace.shared.urlForApplication(toOpen: probeURL) else {
            _ = NSWorkspace.shared.open(url)
            return
        }

        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.open([url], withApplicationAt: appURL, configuration: configuration)
    }

    // MARK: - Alerts

    @MainActor
    private func showNotSyncedAlert() {
        let alert = NSAlert()
        alert.messageText = "Notion link unavailable"
        alert.informativeText = "This item hasn't been synced to Notion yet. Please sync once, then try again."
        alert.addButton(withTitle: "OK")
        _ = alert.runModal()
    }

    @MainActor
    private func showOpenFailedAlert() {
        let alert = NSAlert()
        alert.messageText = "Failed to open Notion"
        alert.informativeText = "Please check your Notion configuration and try again."
        alert.addButton(withTitle: "OK")
        _ = alert.runModal()
    }
}
