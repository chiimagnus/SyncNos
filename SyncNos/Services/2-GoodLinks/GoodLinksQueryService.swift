import Foundation
import SQLite3

// MARK: - GoodLinks Query Service

final class GoodLinksQueryService: Sendable {
    private let logger = DIContainer.shared.loggerService

    func fetchRecentLinks(db: OpaquePointer, limit: Int) throws -> [GoodLinksLinkRow] {
        // 当 limit <= 0 时，展示全部条目（不加 LIMIT）
        // 使用一次性聚合 + LEFT JOIN，实时统计高亮数量，避免依赖可能过期的 link.highlightTotal
        let baseSQL = "SELECT link.id, link.url, link.originalURL, link.title, link.summary, link.author, link.tags, link.starred, link.readAt, link.addedAt, link.modifiedAt, COALESCE(h.cnt, 0) AS highlightTotal FROM link LEFT JOIN (SELECT linkID, COUNT(*) AS cnt FROM highlight GROUP BY linkID) AS h ON h.linkID = link.id ORDER BY link.modifiedAt DESC"
        let sql = limit > 0 ? baseSQL + " LIMIT ?;" : baseSQL + ";"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw NSError(domain: "SyncNos.GoodLinks", code: 1101, userInfo: [NSLocalizedDescriptionKey: "prepare recent links failed"])
        }
        defer { sqlite3_finalize(stmt) }
        if limit > 0 { sqlite3_bind_int64(stmt, 1, Int64(limit)) }
        var rows: [GoodLinksLinkRow] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard let c0 = sqlite3_column_text(stmt, 0), let c1 = sqlite3_column_text(stmt, 1) else { continue }
            let id = String(cString: c0)
            let url = String(cString: c1)
            let originalURL = sqlite3_column_text(stmt, 2).map { String(cString: $0) }
            let title = sqlite3_column_text(stmt, 3).map { String(cString: $0) }
            let summary = sqlite3_column_text(stmt, 4).map { String(cString: $0) }
            let author = sqlite3_column_text(stmt, 5).map { String(cString: $0) }
            let tags = sqlite3_column_text(stmt, 6).map { String(cString: $0) }
            let starred = sqlite3_column_int64(stmt, 7) != 0
            let readAt = sqlite3_column_double(stmt, 8)
            let addedAt = sqlite3_column_double(stmt, 9)
            let modifiedAt = sqlite3_column_double(stmt, 10)
            let highlightTotal: Int? = sqlite3_column_type(stmt, 11) == SQLITE_NULL ? nil : Int(sqlite3_column_int64(stmt, 11))
            rows.append(GoodLinksLinkRow(id: id, url: url, originalURL: originalURL, title: title, summary: summary, author: author, tags: tags, starred: starred, readAt: readAt, addedAt: addedAt, modifiedAt: modifiedAt, highlightTotal: highlightTotal))
        }
        return rows
    }

    func fetchHighlights(db: OpaquePointer, limit: Int, offset: Int) throws -> [GoodLinksHighlightRow] {
        let sql = "SELECT id, linkID, content, color, note, time FROM highlight ORDER BY time DESC LIMIT ? OFFSET ?;"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw NSError(domain: "SyncNos.GoodLinks", code: 1102, userInfo: [NSLocalizedDescriptionKey: "prepare highlights failed"])
        }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int64(stmt, 1, Int64(limit))
        sqlite3_bind_int64(stmt, 2, Int64(offset))
        var rows: [GoodLinksHighlightRow] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard let c0 = sqlite3_column_text(stmt, 0), let c1 = sqlite3_column_text(stmt, 1), let c2 = sqlite3_column_text(stmt, 2) else { continue }
            let id = String(cString: c0)
            let linkId = String(cString: c1)
            let content = String(cString: c2)
            let color: Int? = sqlite3_column_type(stmt, 3) == SQLITE_NULL ? nil : Int(sqlite3_column_int64(stmt, 3))
            let note = sqlite3_column_text(stmt, 4).map { String(cString: $0) }
            let time = sqlite3_column_double(stmt, 5)
            rows.append(GoodLinksHighlightRow(id: id, linkId: linkId, content: content, color: color, note: note, time: time))
        }
        return rows
    }

    func fetchHighlightsForLink(db: OpaquePointer, linkId: String, limit: Int, offset: Int) throws -> [GoodLinksHighlightRow] {
        let sql = "SELECT id, linkID, content, color, note, time FROM highlight WHERE linkID=? ORDER BY time DESC LIMIT ? OFFSET ?;"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw NSError(domain: "SyncNos.GoodLinks", code: 1103, userInfo: [NSLocalizedDescriptionKey: "prepare highlights for link failed"])
        }
        defer { sqlite3_finalize(stmt) }
        let ns = linkId as NSString
        sqlite3_bind_text(stmt, 1, ns.utf8String, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        sqlite3_bind_int64(stmt, 2, Int64(limit))
        sqlite3_bind_int64(stmt, 3, Int64(offset))
        var rows: [GoodLinksHighlightRow] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard let c0 = sqlite3_column_text(stmt, 0), let c1 = sqlite3_column_text(stmt, 1), let c2 = sqlite3_column_text(stmt, 2) else { continue }
            let id = String(cString: c0)
            let linkId = String(cString: c1)
            let content = String(cString: c2)
            let color: Int? = sqlite3_column_type(stmt, 3) == SQLITE_NULL ? nil : Int(sqlite3_column_int64(stmt, 3))
            let note = sqlite3_column_text(stmt, 4).map { String(cString: $0) }
            let time = sqlite3_column_double(stmt, 5)
            rows.append(GoodLinksHighlightRow(id: id, linkId: linkId, content: content, color: color, note: note, time: time))
        }
        return rows
    }

    func fetchHighlightCountsByLink(db: OpaquePointer) throws -> [GoodLinksLinkHighlightCount] {
        let sql = "SELECT linkID, COUNT(*) FROM highlight GROUP BY linkID;"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw NSError(domain: "SyncNos.GoodLinks", code: 1104, userInfo: [NSLocalizedDescriptionKey: "prepare counts failed"])
        }
        defer { sqlite3_finalize(stmt) }
        var rows: [GoodLinksLinkHighlightCount] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard let c0 = sqlite3_column_text(stmt, 0) else { continue }
            let linkId = String(cString: c0)
            let count = Int(sqlite3_column_int64(stmt, 1))
            rows.append(GoodLinksLinkHighlightCount(linkId: linkId, count: count))
        }
        return rows
    }
    
    func fetchContent(db: OpaquePointer, linkId: String) throws -> GoodLinksContentRow? {
        let sql = "SELECT id, content, wordCount, videoDuration FROM content WHERE id=?;"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw NSError(domain: "SyncNos.GoodLinks", code: 1105, userInfo: [NSLocalizedDescriptionKey: "prepare content failed"])
        }
        defer { sqlite3_finalize(stmt) }
        let ns = linkId as NSString
        sqlite3_bind_text(stmt, 1, ns.utf8String, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        
        if sqlite3_step(stmt) == SQLITE_ROW {
            guard let c0 = sqlite3_column_text(stmt, 0) else { return nil }
            let id = String(cString: c0)
            let content = sqlite3_column_text(stmt, 1).map { String(cString: $0) }
            let wordCount = Int(sqlite3_column_int64(stmt, 2))
            let videoDuration: Int? = sqlite3_column_type(stmt, 3) == SQLITE_NULL ? nil : Int(sqlite3_column_int64(stmt, 3))
            return GoodLinksContentRow(id: id, content: content, wordCount: wordCount, videoDuration: videoDuration)
        }
        return nil
    }
}
