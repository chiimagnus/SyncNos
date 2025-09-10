//
//  Export.swift
//  SyncBookNotesWithNotion
//
//  Created by chii_magnus on 2025/9/10.
//

import Foundation

// MARK: - Export

func buildExport(annotations: [HighlightRow], books: [BookRow], filters: Filters?) -> [BookExport] {
    var highlightsByAsset: [String: [Highlight]] = [:]
    for row in annotations {
        highlightsByAsset[row.assetId, default: []].append(Highlight(uuid: row.uuid, text: row.text, note: row.note, style: row.style, dateAdded: row.dateAdded, modified: row.modified))
    }
    var booksIndex: [String: BookRow] = [:]
    for b in books { 
        booksIndex[b.assetId] = b 
    }
    var result: [BookExport] = []
    for (assetId, hs) in highlightsByAsset {
        guard let b = booksIndex[assetId] else { 
            continue 
        }
        if let f = filters, !matches(book: b, filters: f) { 
            continue 
        }
        result.append(BookExport(bookId: assetId, authorName: b.author, bookTitle: b.title, ibooksURL: "ibooks://assetid/\(assetId)", highlights: hs))
    }
    return result.sorted { $0.bookTitle.localizedCaseInsensitiveCompare($1.bookTitle) == .orderedAscending }
}

func writeJSON(_ data: [BookExport], to outPath: String?, pretty: Bool) throws {
    let encoder = JSONEncoder()
    if pretty { 
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys] 
    }
    let bytes = try encoder.encode(data)
    if let path = outPath {
        try bytes.write(to: URL(fileURLWithPath: path), options: .atomic)
    } else {
        if let s = String(data: bytes, encoding: .utf8) { 
            print(s) 
        }
    }
}