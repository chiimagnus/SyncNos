import Foundation
import SQLite3
import AppKit

// MARK: - GoodLinks Read-only Session

final class GoodLinksReadOnlySession: GoodLinksReadOnlySessionProtocol {
    private let db: OpaquePointer
    private let connection: GoodLinksConnectionService
    private let query: GoodLinksQueryService

    init(dbPath: String, connection: GoodLinksConnectionService = GoodLinksConnectionService(), query: GoodLinksQueryService = GoodLinksQueryService()) throws {
        self.connection = connection
        self.query = query
        self.db = try connection.openReadOnlyDatabase(dbPath: dbPath)
    }

    func fetchRecentLinks(limit: Int) throws -> [GoodLinksLinkRow] {
        try query.fetchRecentLinks(db: db, limit: limit)
    }

    func fetchHighlights(limit: Int, offset: Int) throws -> [GoodLinksHighlightRow] {
        try query.fetchHighlights(db: db, limit: limit, offset: offset)
    }

    func fetchHighlightsForLink(linkId: String, limit: Int, offset: Int) throws -> [GoodLinksHighlightRow] {
        try query.fetchHighlightsForLink(db: db, linkId: linkId, limit: limit, offset: offset)
    }

    func fetchHighlightCountsByLink() throws -> [GoodLinksLinkHighlightCount] {
        try query.fetchHighlightCountsByLink(db: db)
    }

    func close() {
        connection.close(db)
    }
}

// MARK: - GoodLinks Database Service

final class GoodLinksDatabaseService: GoodLinksDatabaseServiceProtocol, GoodLinksDatabaseServiceExposed {
    private let connection = GoodLinksConnectionService()

    func defaultDatabasePath() -> String {
        connection.defaultDatabasePath()
    }

    func canOpenReadOnly(dbPath: String) -> Bool {
        connection.canOpenReadOnly(dbPath: dbPath)
    }

    func openReadOnlyDatabase(dbPath: String) throws -> OpaquePointer {
        try connection.openReadOnlyDatabase(dbPath: dbPath)
    }

    func close(_ db: OpaquePointer?) {
        connection.close(db)
    }

    func makeReadOnlySession(dbPath: String) throws -> GoodLinksReadOnlySessionProtocol {
        try GoodLinksReadOnlySession(dbPath: dbPath)
    }
}



// MARK: - GoodLinks Bookmark Store (security-scoped)
final class GoodLinksBookmarkStore {
    static let shared = GoodLinksBookmarkStore()
    private let logger = DIContainer.shared.loggerService

    private let bookmarkDefaultsKey = "SelectedGoodLinksFolderBookmark"
    private var currentlyAccessingURL: URL?

    private init() {}

    func save(folderURL: URL) {
        do {
            let data = try folderURL.bookmarkData(options: [.withSecurityScope],
                                                  includingResourceValuesForKeys: nil,
                                                  relativeTo: nil)
            UserDefaults.standard.set(data, forKey: bookmarkDefaultsKey)
        } catch {
            logger.error("[GoodLinks] Failed to create bookmark: \(error)")
        }
    }

    func restore() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: bookmarkDefaultsKey) else { return nil }
        var isStale = false
        do {
            let url = try URL(resolvingBookmarkData: data,
                              options: [.withSecurityScope],
                              relativeTo: nil,
                              bookmarkDataIsStale: &isStale)
            if isStale { save(folderURL: url) }
            return url
        } catch {
            logger.error("[GoodLinks] Failed to resolve bookmark: \(error)")
            return nil
        }
    }

    @discardableResult
    func startAccessing(url: URL) -> Bool {
        let started = url.startAccessingSecurityScopedResource()
        if started {
            if let current = currentlyAccessingURL, current != url {
                current.stopAccessingSecurityScopedResource()
            }
            currentlyAccessingURL = url
        }
        return started
    }

    func stopAccessingIfNeeded() {
        if let current = currentlyAccessingURL {
            current.stopAccessingSecurityScopedResource()
            currentlyAccessingURL = nil
        }
    }
}

// MARK: - GoodLinks Folder Picker
public struct GoodLinksPicker {
    public static func pickGoodLinksFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.prompt = "Choose"
        panel.message = "请选择 GoodLinks 的共享容器目录 (group.com.ngocluu.goodlinks) 或其 Data 路径"

        let home = NSHomeDirectory()
        let defaultContainer = "\(home)/Library/Group Containers/group.com.ngocluu.goodlinks"
        panel.directoryURL = URL(fileURLWithPath: defaultContainer, isDirectory: true)

        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            GoodLinksBookmarkStore.shared.save(folderURL: url)
            _ = GoodLinksBookmarkStore.shared.startAccessing(url: url)
            let selectedPath = url.path
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: Notification.Name("GoodLinksFolderSelected"), object: selectedPath)
            }
        }
    }
}

// MARK: - GoodLinks View Model (List + Detail)
final class GoodLinksViewModel: ObservableObject {
    @Published var links: [GoodLinksLinkRow] = []
    @Published var highlightsByLinkId: [String: [GoodLinksHighlightRow]] = [:]
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?

    private let service: GoodLinksDatabaseServiceExposed
    private let logger = DIContainer.shared.loggerService

    init(service: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService) {
        self.service = service
    }

    func loadRecentLinks(limit: Int = 200) {
        isLoading = true
        errorMessage = nil

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                let dbPath = self.resolveDatabasePath()
                let session = try self.service.makeReadOnlySession(dbPath: dbPath)
                defer { session.close() }
                let rows = try session.fetchRecentLinks(limit: limit)
                DispatchQueue.main.async {
                    self.links = rows
                    self.isLoading = false
                    self.logger.info("[GoodLinks] loaded links: \(rows.count)")
                }
            } catch {
                let desc = error.localizedDescription
                self.logger.error("[GoodLinks] loadRecentLinks error: \(desc)")
                DispatchQueue.main.async {
                    self.errorMessage = desc
                    self.isLoading = false
                }
            }
        }
    }

    func loadHighlights(for linkId: String, limit: Int = 500, offset: Int = 0) {
        logger.info("[GoodLinks] 开始加载高亮，linkId=\(linkId)")
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                let dbPath = self.resolveDatabasePath()
                self.logger.info("[GoodLinks] 数据库路径: \(dbPath)")
                let session = try self.service.makeReadOnlySession(dbPath: dbPath)
                defer { session.close() }
                let rows = try session.fetchHighlightsForLink(linkId: linkId, limit: limit, offset: offset)
                self.logger.info("[GoodLinks] 加载到 \(rows.count) 条高亮，linkId=\(linkId)")
                DispatchQueue.main.async {
                    self.highlightsByLinkId[linkId] = rows
                    self.logger.info("[GoodLinks] 高亮数据已更新到UI，linkId=\(linkId), count=\(rows.count)")
                }
            } catch {
                let desc = error.localizedDescription
                self.logger.error("[GoodLinks] loadHighlights error: \(desc)")
                DispatchQueue.main.async {
                    self.errorMessage = desc
                }
            }
        }
    }

    // MARK: - Path Helpers
    private func resolveDatabasePath() -> String {
        // If user granted access to group container/Data, prefer it; otherwise fall back to default path
        if let url = GoodLinksBookmarkStore.shared.restore() {
            _ = GoodLinksBookmarkStore.shared.startAccessing(url: url)
            let path = url.path
            // Normalize to Data/data.sqlite
            let last = (path as NSString).lastPathComponent
            if last == "Data" {
                return (path as NSString).appendingPathComponent("data.sqlite")
            }
            if last.hasPrefix("group.com.ngocluu.goodlinks") || path.hasSuffix("/Group Containers/group.com.ngocluu.goodlinks") {
                return ((path as NSString).appendingPathComponent("Data") as NSString).appendingPathComponent("data.sqlite")
            }
            // If user picked a deeper path that already contains data.sqlite's directory
            let candidate = (path as NSString).appendingPathComponent("Data/data.sqlite")
            if FileManager.default.fileExists(atPath: candidate) {
                return candidate
            }
        }
        // Fallback to the default known location
        return GoodLinksConnectionService().defaultDatabasePath()
    }
}

