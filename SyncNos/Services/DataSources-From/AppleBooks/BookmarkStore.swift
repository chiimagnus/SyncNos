import Foundation

final class BookmarkStore: BookmarkStoreProtocol {
    static let shared = BookmarkStore()
    private let logger = DIContainer.shared.loggerService

    private let bookmarkDefaultsKey = "SelectedBooksFolderBookmark"
    private var currentlyAccessingURL: URL?

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
