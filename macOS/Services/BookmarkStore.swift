//
//  BookmarkStore.swift
//  SyncBookNotesWithNotion
//
//  Created by chii_magnus on 2025/9/10.
//

import Foundation

final class BookmarkStore {
    static let shared = BookmarkStore()
    
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
            UserDefaults.standard.synchronize()
        } catch {
            print("Failed to create bookmark for URL: \(folderURL.path), error: \(error)")
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
            print("Failed to resolve bookmark: \(error)")
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
}


