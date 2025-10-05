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
    
    func fetchContent(linkId: String) throws -> GoodLinksContentRow? {
        try query.fetchContent(db: db, linkId: linkId)
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

    // MARK: - Convenience helpers for app layer
    func resolveDatabasePath() -> String {
        if let url = GoodLinksBookmarkStore.shared.restore() {
            _ = GoodLinksBookmarkStore.shared.startAccessing(url: url)
            let path = url.path
            let last = (path as NSString).lastPathComponent
            if last == "Data" {
                return (path as NSString).appendingPathComponent("data.sqlite")
            }
            if last.hasPrefix("group.com.ngocluu.goodlinks") || path.hasSuffix("/Group Containers/group.com.ngocluu.goodlinks") {
                return ((path as NSString).appendingPathComponent("Data") as NSString).appendingPathComponent("data.sqlite")
            }
            let candidate = (path as NSString).appendingPathComponent("Data/data.sqlite")
            if FileManager.default.fileExists(atPath: candidate) {
                return candidate
            }
        }
        return GoodLinksConnectionService().defaultDatabasePath()
    }

    func fetchRecentLinks(dbPath: String, limit: Int) throws -> [GoodLinksLinkRow] {
        let session = try makeReadOnlySession(dbPath: dbPath)
        defer { session.close() }
        return try session.fetchRecentLinks(limit: limit)
    }

    func fetchHighlightsForLink(dbPath: String, linkId: String, limit: Int, offset: Int) throws -> [GoodLinksHighlightRow] {
        let session = try makeReadOnlySession(dbPath: dbPath)
        defer { session.close() }
        return try session.fetchHighlightsForLink(linkId: linkId, limit: limit, offset: offset)
    }

    func fetchContent(dbPath: String, linkId: String) throws -> GoodLinksContentRow? {
        let session = try makeReadOnlySession(dbPath: dbPath)
        defer { session.close() }
        return try session.fetchContent(linkId: linkId)
    }
}

// MARK: - GoodLinks Bookmark Store (security-scoped)
final class GoodLinksBookmarkStore {
    static let shared = GoodLinksBookmarkStore()
    private let logger = DIContainer.shared.loggerService

    private let bookmarkDefaultsKey = "SelectedGoodLinksFolderBookmark"
    private var currentlyAccessingURL: URL?
    private var accessCount: Int = 0
    private let queue = DispatchQueue(label: "GoodLinksBookmarkStore.serial")

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
        queue.sync {
            let normalized = url.standardizedFileURL
            if let current = currentlyAccessingURL {
                // Same target → increase OS refcount and our own count
                if current.standardizedFileURL == normalized {
                    let started = normalized.startAccessingSecurityScopedResource()
                    if started { accessCount += 1 }
                    return started
                }

                // Different target → attempt to start new first; if succeeded, stop previous fully
                let started = normalized.startAccessingSecurityScopedResource()
                if started {
                    // Drain previous access count to 0
                    while accessCount > 0 {
                        current.stopAccessingSecurityScopedResource()
                        accessCount -= 1
                    }
                    currentlyAccessingURL = normalized
                    accessCount = 1
                    return true
                } else {
                    // Keep previous access; report failure
                    return false
                }
            } else {
                // No current → start and set count
                let started = normalized.startAccessingSecurityScopedResource()
                if started {
                    currentlyAccessingURL = normalized
                    accessCount = 1
                }
                return started
            }
        }
    }

    func stopAccessingIfNeeded() {
        queue.sync {
            if let current = currentlyAccessingURL {
                while accessCount > 0 {
                    current.stopAccessingSecurityScopedResource()
                    accessCount -= 1
                }
                currentlyAccessingURL = nil
            }
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
