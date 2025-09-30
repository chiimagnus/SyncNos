import Foundation

final class BookmarkStore: BookmarkStoreProtocol {
    static let shared = BookmarkStore()
    private let logger = DIContainer.shared.loggerService

    private let bookmarkDefaultsKey = "SelectedBooksFolderBookmark"
    private let iBooksBookmarkDefaultsKey = "iCloudBooksDirectoryBookmark"
    private var currentlyAccessingURL: URL?
    private var currentlyAccessingiBooksURL: URL?

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
    
    @discardableResult
    func startAccessing(url: URL) -> Bool {
        let started = url.startAccessingSecurityScopedResource()
        if started {
            // Stop previous one if different
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
    
    // MARK: - iCloud Books Directory Management
    func saveiBooksDirectory(url: URL) {
        do {
            let data = try url.bookmarkData(options: [.withSecurityScope],
                                           includingResourceValuesForKeys: nil,
                                           relativeTo: nil)
            UserDefaults.standard.set(data, forKey: iBooksBookmarkDefaultsKey)
            logger.info("Saved iCloud Books directory bookmark")
        } catch {
            logger.error("Failed to create iBooks bookmark for URL: \(url.path), error: \(error)")
        }
    }
    
    func restoreiBooksDirectory() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: iBooksBookmarkDefaultsKey) else {
            return nil
        }
        var isStale = false
        do {
            let url = try URL(resolvingBookmarkData: data,
                             options: [.withSecurityScope],
                             relativeTo: nil,
                             bookmarkDataIsStale: &isStale)
            if isStale {
                saveiBooksDirectory(url: url)
            }
            return url
        } catch {
            logger.error("Failed to resolve iBooks bookmark: \(error)")
            return nil
        }
    }
    
    @discardableResult
    func startAccessingiBooksDirectory(url: URL) -> Bool {
        let started = url.startAccessingSecurityScopedResource()
        if started {
            if let current = currentlyAccessingiBooksURL, current != url {
                current.stopAccessingSecurityScopedResource()
            }
            currentlyAccessingiBooksURL = url
        }
        return started
    }
    
    func stopAccessingiBooksDirectoryIfNeeded() {
        if let current = currentlyAccessingiBooksURL {
            current.stopAccessingSecurityScopedResource()
            currentlyAccessingiBooksURL = nil
        }
    }
}
