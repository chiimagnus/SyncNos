//
//  DatabaseService.swift
//  SyncBookNotesWithNotion
//
//  Created by chii_magnus on 2025/9/10.
//

import Foundation
import SQLite3

// MARK: - DatabaseService

class DatabaseService {
    // Bridge C macro SQLITE_TRANSIENT for Swift
    private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    
    // MARK: - SQLite helpers
    
    func canOpenReadOnly(dbPath: String) -> Bool {
        var db: OpaquePointer?
        let rc = sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil)
        if rc == SQLITE_OK {
            sqlite3_close(db)
            return true
        }
        return false
    }
    
    func openReadOnlyDatabase(dbPath: String) throws -> OpaquePointer {
        var db: OpaquePointer?
        let rc = sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil)
        guard rc == SQLITE_OK, let handle = db else {
            throw NSError(domain: "SyncBookNotes", code: 10, userInfo: [NSLocalizedDescriptionKey: "Failed to open SQLite database at \(dbPath) (rc=\(rc))"])
        }
        return handle
    }
    
    func finalize(_ stmt: OpaquePointer?) {
        if let s = stmt { 
            sqlite3_finalize(s) 
        }
    }
    
    func close(_ db: OpaquePointer?) {
        if let d = db { 
            sqlite3_close(d) 
        }
    }
    
    // MARK: - Queries
    
    func matches(book: BookRow, filters: Filters) -> Bool {
        // asset filter (exact) if provided
        if !filters.assetIds.isEmpty && !filters.assetIds.contains(book.assetId) { 
            return false 
        }
        // title substring OR logic
        if !filters.bookSubstrings.isEmpty {
            let t = book.title.lowercased()
            if !filters.bookSubstrings.contains(where: { t.contains($0.lowercased()) }) { 
                return false 
            }
        }
        // author substring OR logic
        if !filters.authorSubstrings.isEmpty {
            let a = book.author.lowercased()
            if !filters.authorSubstrings.contains(where: { a.contains($0.lowercased()) }) { 
                return false 
            }
        }
        return true
    }
    
    func fetchAnnotations(db: OpaquePointer) throws -> [HighlightRow] {
        let sql = "SELECT ZANNOTATIONASSETID,ZANNOTATIONUUID,ZANNOTATIONSELECTEDTEXT FROM ZAEANNOTATION WHERE ZANNOTATIONDELETED=0 AND ZANNOTATIONSELECTEDTEXT NOT NULL;"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw NSError(domain: "SyncBookNotes", code: 20, userInfo: [NSLocalizedDescriptionKey: "Prepare failed: annotations"])
        }
        defer { finalize(stmt) }
        var rows: [HighlightRow] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard let c0 = sqlite3_column_text(stmt, 0), 
                  let c1 = sqlite3_column_text(stmt, 1), 
                  let c2 = sqlite3_column_text(stmt, 2) else { 
                continue 
            }
            let assetId = String(cString: c0)
            let uuid = String(cString: c1)
            let text = String(cString: c2).trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { 
                continue 
            }
            rows.append(HighlightRow(assetId: assetId, uuid: uuid, text: text))
        }
        return rows
    }
    
    func fetchBooks(db: OpaquePointer, assetIds: [String]) throws -> [BookRow] {
        guard !assetIds.isEmpty else { 
            return [] 
        }
        let placeholders = Array(repeating: "?", count: assetIds.count).joined(separator: ",")
        let sql = "SELECT ZASSETID,ZAUTHOR,ZTITLE FROM ZBKLIBRARYASSET WHERE ZASSETID IN (\(placeholders));"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw NSError(domain: "SyncBookNotes", code: 20, userInfo: [NSLocalizedDescriptionKey: "Prepare failed: books"])
        }
        defer { finalize(stmt) }
        for (i, id) in assetIds.enumerated() {
            let ns = id as NSString
            sqlite3_bind_text(stmt, Int32(i + 1), ns.utf8String, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        }
        var rows: [BookRow] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard let c0 = sqlite3_column_text(stmt, 0), 
                  let c1 = sqlite3_column_text(stmt, 1), 
                  let c2 = sqlite3_column_text(stmt, 2) else { 
                continue 
            }
            rows.append(BookRow(assetId: String(cString: c0), author: String(cString: c1), title: String(cString: c2)))
        }
        return rows
    }
    
    // MARK: - Inspect helpers
    
    func countRows(db: OpaquePointer, table: String) -> Int? {
        var stmt: OpaquePointer?
        let sql = "SELECT COUNT(*) FROM \(table)"
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { 
            return nil 
        }
        defer { finalize(stmt) }
        if sqlite3_step(stmt) == SQLITE_ROW { 
            return Int(sqlite3_column_int64(stmt, 0)) 
        }
        return nil
    }
}