//
//  macOSApp.swift
//  SyncBookNotesWithNotion
//
//  Created by chii_magnus on 2025/9/10.
//

import SwiftUI

@main
struct macOSApp: App {
    init() {
        // Try auto-restore bookmark at launch
        if let url = BookmarkStore.shared.restore() {
            let started = BookmarkStore.shared.startAccessing(url: url)
            print("Restored bookmark: \(url.path), startAccess=\(started)")
        } else {
            print("No saved bookmark to restore")
        }
    }
    var body: some Scene {
        WindowGroup {
            BooksListView()
        }
    }
}