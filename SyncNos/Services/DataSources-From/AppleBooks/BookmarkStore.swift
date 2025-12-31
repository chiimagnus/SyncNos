import Foundation

final class BookmarkStore: BookmarkStoreProtocol {
    static let shared = BookmarkStore()
    private let logger = DIContainer.shared.loggerService

    private let bookmarkDefaultsKey = "SelectedBooksFolderBookmark"
    private var currentlyAccessingURL: URL?
    private var accessCount: Int = 0
    private let queue = DispatchQueue(label: "AppleBooksBookmarkStore.serial")

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
            guard let current = currentlyAccessingURL else { return }
            guard accessCount > 0 else {
                currentlyAccessingURL = nil
                return
            }
            // 仅减少一次引用计数，不是清空所有
            current.stopAccessingSecurityScopedResource()
            accessCount -= 1
            if accessCount == 0 {
                currentlyAccessingURL = nil
            }
        }
    }
}
