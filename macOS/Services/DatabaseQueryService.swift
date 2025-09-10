//
//  DatabaseQueryService.swift
//  SyncBookNotesWithNotion
//
//  Created by chii_magnus on 2025/9/10.
//

import Foundation
import SQLite3

// MARK: - Database Query Service
/// 专门处理数据库查询的类，遵循单一职责原则
class DatabaseQueryService {
    
    // MARK: - Queries
    func fetchAnnotations(db: OpaquePointer) throws -> [HighlightRow] {
        let sql = "SELECT ZANNOTATIONASSETID,ZANNOTATIONUUID,ZANNOTATIONSELECTEDTEXT FROM ZAEANNOTATION WHERE ZANNOTATIONDELETED=0 AND ZANNOTATIONSELECTEDTEXT NOT NULL;"
        print("Executing query: \(sql)")
        
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            let error = "Prepare failed: annotations"
            print("Database error: \(error)")
            throw NSError(domain: "SyncBookNotes", code: 20, userInfo: [NSLocalizedDescriptionKey: error])
        }
        
        var rows: [HighlightRow] = []
        var count = 0
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
            count += 1
        }
        sqlite3_finalize(stmt)
        print("Fetched \(count) valid annotations")
        return rows
    }
    
    func fetchBooks(db: OpaquePointer, assetIds: [String]) throws -> [BookRow] {
        guard !assetIds.isEmpty else { 
            print("No asset IDs provided, returning empty books array")
            return [] 
        }
        
        let placeholders = Array(repeating: "?", count: assetIds.count).joined(separator: ",")
        let sql = "SELECT ZASSETID,ZAUTHOR,ZTITLE FROM ZBKLIBRARYASSET WHERE ZASSETID IN (\(placeholders));"
        print("Executing query: \(sql)")
        
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            let error = "Prepare failed: books"
            print("Database error: \(error)")
            throw NSError(domain: "SyncBookNotes", code: 20, userInfo: [NSLocalizedDescriptionKey: error])
        }
        
        for (i, id) in assetIds.enumerated() {
            let ns = id as NSString
            sqlite3_bind_text(stmt, Int32(i + 1), ns.utf8String, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        }
        
        var rows: [BookRow] = []
        var count = 0
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard let c0 = sqlite3_column_text(stmt, 0), 
                  let c1 = sqlite3_column_text(stmt, 1), 
                  let c2 = sqlite3_column_text(stmt, 2) else { 
                continue 
            }
            rows.append(BookRow(assetId: String(cString: c0), author: String(cString: c1), title: String(cString: c2)))
            count += 1
        }
        sqlite3_finalize(stmt)
        print("Fetched \(count) books")
        return rows
    }
    
    // MARK: - Inspect helpers
    func countRows(db: OpaquePointer, table: String) -> Int? {
        var stmt: OpaquePointer?
        let sql = "SELECT COUNT(*) FROM \(table)"
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { 
            return nil 
        }
        defer { sqlite3_finalize(stmt) }
        if sqlite3_step(stmt) == SQLITE_ROW { 
            return Int(sqlite3_column_int64(stmt, 0)) 
        }
        return nil
    }
}