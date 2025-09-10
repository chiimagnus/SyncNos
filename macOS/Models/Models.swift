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
    let note: String?
    let style: Int?
    let stylingColor: String?
    let dateAdded: Date?
    let modified: Date?
    let location: Int?
    let rangeStart: Int?
    let rangeEnd: Int?
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
    let note: String?
    let style: Int?
    let stylingColor: String?
    let dateAdded: Date?
    let modified: Date?
    let location: Int?
    let rangeStart: Int?
    let rangeEnd: Int?
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