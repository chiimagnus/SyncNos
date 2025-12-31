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
        let normalized = url.standardizedFileURL
        // 如果已经在访问同一个 URL，直接返回 true
        if let current = currentlyAccessingURL, current.standardizedFileURL == normalized {
            return true
        }
        
        let started = normalized.startAccessingSecurityScopedResource()
        if started {
            // 如果之前在访问其他 URL，先停止
            if let current = currentlyAccessingURL, current.standardizedFileURL != normalized {
                current.stopAccessingSecurityScopedResource()
            }
            currentlyAccessingURL = normalized
        }
        return started
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

        // 使用用户的真实 home 目录，而不是沙盒容器路径
        // NSHomeDirectory() 在沙盒应用中会返回应用容器路径，所以我们需要使用 pw_dir
        let realHomeDirectory: String
        if let pw = getpwuid(getuid()), let home = pw.pointee.pw_dir {
            realHomeDirectory = String(cString: home)
        } else {
            // Fallback to environment variable
            realHomeDirectory = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
        }
        let defaultContainer = "\(realHomeDirectory)/Library/Group Containers/group.com.ngocluu.goodlinks"
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
