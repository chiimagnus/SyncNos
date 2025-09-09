//
//  Models.swift
//  SyncBookNotesWithNotion
//
//  Created by chii_magnus on 2025/9/10.
//

import Foundation

// MARK: - Types

struct Highlight: Codable {
    let uuid: String
    let text: String
}

struct BookExport: Codable {
    let bookId: String
    let authorName: String
    let bookTitle: String
    let ibooksURL: String
    let highlights: [Highlight]
}

struct HighlightRow { 
    let assetId: String
    let uuid: String
    let text: String 
}

struct BookRow { 
    let assetId: String
    let author: String
    let title: String 
}

struct Filters { 
    let bookSubstrings: [String]
    let authorSubstrings: [String]
    let assetIds: [String] 
}

// MARK: - Exit Codes

enum ExitCode: Int32 {
    case success = 0
    case argumentError = 2
    case dbOpenFailed = 10
    case queryFailed = 20
}