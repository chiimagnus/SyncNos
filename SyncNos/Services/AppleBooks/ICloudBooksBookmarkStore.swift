import Foundation

final class ICloudBooksBookmarkStore {
    static let shared = ICloudBooksBookmarkStore()
    private let logger = DIContainer.shared.loggerService

    private let bookmarkDefaultsKey = "SelectedICloudBooksFolderBookmark"
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
            logger.error("Failed to resolve iCloud Books bookmark: \(error)")
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


