import Foundation

final class BookmarkStore: BookmarkStoreProtocol {
    static let shared = BookmarkStore()
    private let logger = DIContainer.shared.loggerService

    private let bookmarkDefaultsKey = "SelectedBooksFolderBookmark"
    private let localBookmarkDefaultsKey = "SelectedLocalBooksFolderBookmark"
    private let iCloudBooksBookmarkDefaultsKey = "SelectedICloudBooksFolderBookmark"
    private var currentlyAccessingURLs: Set<URL> = []

    private init() {}
    
    // MARK: - Public API
    func save(folderURL: URL) {
        do {
            let data = try folderURL.bookmarkData(options: [.withSecurityScope],
                                                  includingResourceValuesForKeys: nil,
                                                  relativeTo: nil)
            UserDefaults.standard.set(data, forKey: bookmarkDefaultsKey)
        } catch {
            logger.error("Failed to create bookmark for URL: \(folderURL.path), error: \(error)")
        }
    }
    
    // 专用于本地 Books 容器（如 com.apple.BKAgentService）
    func saveLocal(folderURL: URL) {
        do {
            let data = try folderURL.bookmarkData(options: [.withSecurityScope],
                                                  includingResourceValuesForKeys: nil,
                                                  relativeTo: nil)
            UserDefaults.standard.set(data, forKey: localBookmarkDefaultsKey)
        } catch {
            logger.error("Failed to create local bookmark for URL: \(folderURL.path), error: \(error)")
        }
    }

    // 专用于 iCloud Books 目录（~/Library/Mobile Documents/iCloud~com~apple~iBooks/Documents）
    func saveICloudBooks(folderURL: URL) {
        do {
            let data = try folderURL.bookmarkData(options: [.withSecurityScope],
                                                  includingResourceValuesForKeys: nil,
                                                  relativeTo: nil)
            UserDefaults.standard.set(data, forKey: iCloudBooksBookmarkDefaultsKey)
        } catch {
            logger.error("Failed to create iCloud Books bookmark for URL: \(folderURL.path), error: \(error)")
        }
    }
    
    func restore() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: bookmarkDefaultsKey) else {
            return nil
        }
        var isStale = false
        do {
            let url = try URL(resolvingBookmarkData: data,
                              options: [.withSecurityScope],
                              relativeTo: nil,
                              bookmarkDataIsStale: &isStale)
            if isStale {
                // Refresh the bookmark
                save(folderURL: url)
            }
            return url
        } catch {
            logger.error("Failed to resolve bookmark: \(error)")
            return nil
        }
    }
    
    // 读取本地 Books 容器书签
    func restoreLocal() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: localBookmarkDefaultsKey) else {
            return nil
        }
        var isStale = false
        do {
            let url = try URL(resolvingBookmarkData: data,
                              options: [.withSecurityScope],
                              relativeTo: nil,
                              bookmarkDataIsStale: &isStale)
            if isStale {
                saveLocal(folderURL: url)
            }
            return url
        } catch {
            logger.error("Failed to resolve local bookmark: \(error)")
            return nil
        }
    }

    // 读取 iCloud Books 书签
    func restoreICloudBooks() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: iCloudBooksBookmarkDefaultsKey) else {
            return nil
        }
        var isStale = false
        do {
            let url = try URL(resolvingBookmarkData: data,
                              options: [.withSecurityScope],
                              relativeTo: nil,
                              bookmarkDataIsStale: &isStale)
            if isStale {
                saveICloudBooks(folderURL: url)
            }
            return url
        } catch {
            logger.error("Failed to resolve iCloud Books bookmark: \(error)")
            return nil
        }
    }
    
    @discardableResult
    func startAccessing(url: URL) -> Bool {
        let started = url.startAccessingSecurityScopedResource()
        if started {
            // Keep multiple active URLs; do not stop previous to avoid breaking DB access
            currentlyAccessingURLs.insert(url)
        }
        return started
    }
    
    func stopAccessingIfNeeded() {
        for url in currentlyAccessingURLs {
            url.stopAccessingSecurityScopedResource()
        }
        currentlyAccessingURLs.removeAll()
    }
}
