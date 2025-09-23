import Foundation
import SQLite3

// MARK: - Database Query Service
/// 专门处理数据库查询的类，遵循单一职责原则
class DatabaseQueryService {
    
    // MARK: - Queries
    func fetchAnnotations(db: OpaquePointer) throws -> [HighlightRow] {
        // 首先获取表结构信息，动态构建查询语句
        let tableInfoSQL = "PRAGMA table_info('ZAEANNOTATION');"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, tableInfoSQL, -1, &stmt, nil) == SQLITE_OK else {
            let error = "Prepare failed: table info"
            print("Database error: \(error)")
            throw NSError(domain: "SyncBookNotes", code: 20, userInfo: [NSLocalizedDescriptionKey: error])
        }
        
        // 收集可用的列名
        var availableColumns: Set<String> = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            if let columnName = sqlite3_column_text(stmt, 1) {
                availableColumns.insert(String(cString: columnName))
            }
        }
        sqlite3_finalize(stmt)
        
        // 构建查询语句，只包含存在的列
        var selectColumns: [String] = ["ZANNOTATIONASSETID", "ZANNOTATIONUUID", "ZANNOTATIONSELECTEDTEXT"]
        var columnIndices: [String: Int] = [
            "ZANNOTATIONASSETID": 0,
            "ZANNOTATIONUUID": 1,
            "ZANNOTATIONSELECTEDTEXT": 2
        ]
        
        // 检查并添加可选列
        let optionalColumns = [
            "ZANNOTATIONNOTE": "note",
            "ZANNOTATIONSTYLE": "style",
            "ZANNOTATIONCREATIONDATE": "dateAdded",
            "ZANNOTATIONMODIFICATIONDATE": "modified",
            "ZANNOTATIONLOCATION": "location"
        ]
        
        var nextIndex = 3
        for (column, _) in optionalColumns {
            if availableColumns.contains(column) {
                selectColumns.append(column)
                columnIndices[column] = nextIndex
                nextIndex += 1
            }
        }
        
        let sql = "SELECT \(selectColumns.joined(separator: ",")) FROM ZAEANNOTATION WHERE ZANNOTATIONDELETED=0 AND ZANNOTATIONSELECTEDTEXT NOT NULL;"
        print("Executing query: \(sql)")
        
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
            
            // 获取可选字段
            var note: String? = nil
            var style: Int? = nil
            var dateAdded: Date? = nil
            var modified: Date? = nil
            var location: String? = nil
            
            // 根据实际的列索引获取数据
            if let noteIndex = columnIndices["ZANNOTATIONNOTE"], noteIndex < Int(sqlite3_column_count(stmt)) {
                note = sqlite3_column_text(stmt, Int32(noteIndex)).map { String(cString: $0) }
            }
            
            if let styleIndex = columnIndices["ZANNOTATIONSTYLE"], styleIndex < Int(sqlite3_column_count(stmt)) {
                if sqlite3_column_type(stmt, Int32(styleIndex)) != SQLITE_NULL {
                    style = Int(sqlite3_column_int64(stmt, Int32(styleIndex)))
                }
            }
            
            if let dateAddedIndex = columnIndices["ZANNOTATIONCREATIONDATE"], dateAddedIndex < Int(sqlite3_column_count(stmt)) {
                if sqlite3_column_type(stmt, Int32(dateAddedIndex)) != SQLITE_NULL {
                    dateAdded = Date(timeIntervalSinceReferenceDate: TimeInterval(sqlite3_column_double(stmt, Int32(dateAddedIndex))))
                }
            }
            
            if let modifiedIndex = columnIndices["ZANNOTATIONMODIFICATIONDATE"], modifiedIndex < Int(sqlite3_column_count(stmt)) {
                if sqlite3_column_type(stmt, Int32(modifiedIndex)) != SQLITE_NULL {
                    modified = Date(timeIntervalSinceReferenceDate: TimeInterval(sqlite3_column_double(stmt, Int32(modifiedIndex))))
                }
            }
            
            if let locationIndex = columnIndices["ZANNOTATIONLOCATION"], locationIndex < Int(sqlite3_column_count(stmt)) {
                if sqlite3_column_type(stmt, Int32(locationIndex)) != SQLITE_NULL {
                    location = sqlite3_column_text(stmt, Int32(locationIndex)).map { String(cString: $0) }
                }
            }
            
            rows.append(HighlightRow(assetId: assetId, uuid: uuid, text: text, note: note, style: style, dateAdded: dateAdded, modified: modified, location: location))
            count += 1
        }
        sqlite3_finalize(stmt)
        print("Fetched \(count) valid annotations")
        return rows
    }
    
    /// 按图书(assetId)聚合高亮数量，用于列表快速展示
    func fetchHighlightCountsByAsset(db: OpaquePointer) throws -> [AssetHighlightCount] {
        let sql = "SELECT ZANNOTATIONASSETID, COUNT(*) FROM ZAEANNOTATION WHERE ZANNOTATIONDELETED=0 AND ZANNOTATIONSELECTEDTEXT NOT NULL GROUP BY ZANNOTATIONASSETID;"
        print("Executing query: \(sql)")
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            let error = "Prepare failed: counts by asset"
            print("Database error: \(error)")
            throw NSError(domain: "SyncBookNotes", code: 20, userInfo: [NSLocalizedDescriptionKey: error])
        }
        defer { sqlite3_finalize(stmt) }
        var results: [AssetHighlightCount] = []
        var count = 0
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard let c0 = sqlite3_column_text(stmt, 0) else { continue }
            let assetId = String(cString: c0)
            let c = Int(sqlite3_column_int64(stmt, 1))
            results.append(AssetHighlightCount(assetId: assetId, count: c))
            count += 1
        }
        print("Fetched counts for \(count) assets")
        return results
    }

    /// 拉取指定图书的一页高亮（MVP: 使用 LIMIT/OFFSET 分页）
    func fetchHighlightPage(db: OpaquePointer, assetId: String, limit: Int, offset: Int) throws -> [HighlightRow] {
        return try fetchHighlightPage(db: db, assetId: assetId, limit: limit, offset: offset, since: nil)
    }

    /// 拉取指定图书的一页高亮（支持增量同步）
    /// - Parameters:
    ///   - db: 数据库连接
    ///   - assetId: 书籍ID
    ///   - limit: 限制数量
    ///   - offset: 偏移量
    ///   - since: 只获取此时间之后修改的高亮（用于增量同步）
    /// - Returns: 高亮数组
    func fetchHighlightPage(db: OpaquePointer, assetId: String, limit: Int, offset: Int, since: Date? = nil) throws -> [HighlightRow] {
        // Discover available columns for dynamic select and optional fields
        let tableInfoSQL = "PRAGMA table_info('ZAEANNOTATION');"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, tableInfoSQL, -1, &stmt, nil) == SQLITE_OK else {
            let error = "Prepare failed: table info (page)"
            print("Database error: \(error)")
            throw NSError(domain: "SyncBookNotes", code: 20, userInfo: [NSLocalizedDescriptionKey: error])
        }
        var availableColumns: Set<String> = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            if let columnName = sqlite3_column_text(stmt, 1) {
                availableColumns.insert(String(cString: columnName))
            }
        }
        sqlite3_finalize(stmt)

        var selectColumns: [String] = ["ZANNOTATIONASSETID", "ZANNOTATIONUUID", "ZANNOTATIONSELECTEDTEXT"]
        var columnIndices: [String: Int] = [
            "ZANNOTATIONASSETID": 0,
            "ZANNOTATIONUUID": 1,
            "ZANNOTATIONSELECTEDTEXT": 2
        ]

        let optionalColumns = [
            "ZANNOTATIONNOTE": "note",
            "ZANNOTATIONSTYLE": "style",
            "ZANNOTATIONCREATIONDATE": "dateAdded",
            "ZANNOTATIONMODIFICATIONDATE": "modified",
            "ZANNOTATIONLOCATION": "location"
        ]
        var nextIndex = 3
        for (column, _) in optionalColumns {
            if availableColumns.contains(column) {
                selectColumns.append(column)
                columnIndices[column] = nextIndex
                nextIndex += 1
            }
        }

        // 构建基础查询
        var whereConditions = [
            "ZANNOTATIONDELETED=0",
            "ZANNOTATIONSELECTEDTEXT NOT NULL",
            "ZANNOTATIONASSETID=?"
        ]

        // 如果是增量同步，添加时间条件
        if since != nil && availableColumns.contains("ZANNOTATIONMODIFICATIONDATE") {
            whereConditions.append("ZANNOTATIONMODIFICATIONDATE >= ?")
        }

        let orderBy: String
        if availableColumns.contains("ZANNOTATIONCREATIONDATE") {
            orderBy = "ZANNOTATIONCREATIONDATE DESC"
        } else {
            // Fallback: use ROWID to get stable order
            orderBy = "rowid DESC"
        }

        let whereClause = whereConditions.joined(separator: " AND ")
        let sql = "SELECT \(selectColumns.joined(separator: ",")) FROM ZAEANNOTATION WHERE \(whereClause) ORDER BY \(orderBy) LIMIT ? OFFSET ?;"
        print("DEBUG: 执行查询: \(sql)")
        print("DEBUG: 查询参数 - assetId: \(assetId), limit: \(limit), offset: \(offset)" + (since != nil ? ", since: \(since!)" : ""))

        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            let error = "Prepare failed: highlight page"
            print("Database error: \(error)")
            throw NSError(domain: "SyncBookNotes", code: 20, userInfo: [NSLocalizedDescriptionKey: error])
        }
        defer { sqlite3_finalize(stmt) }

        // 绑定参数
        let nsAssetId = assetId as NSString
        sqlite3_bind_text(stmt, 1, nsAssetId.utf8String, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))

        var bindIndex = 2
        if since != nil && availableColumns.contains("ZANNOTATIONMODIFICATIONDATE") {
            // 绑定时间参数（转换为SQLite的时间格式）
            let timeInterval = since!.timeIntervalSinceReferenceDate
            sqlite3_bind_double(stmt, Int32(bindIndex), timeInterval)
            bindIndex += 1
        }

        sqlite3_bind_int64(stmt, Int32(bindIndex), Int64(limit))
        sqlite3_bind_int64(stmt, Int32(bindIndex + 1), Int64(offset))

        var rows: [HighlightRow] = []
        var fetched = 0
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard let c0 = sqlite3_column_text(stmt, 0),
                  let c1 = sqlite3_column_text(stmt, 1),
                  let c2 = sqlite3_column_text(stmt, 2) else {
                continue
            }
            let assetId = String(cString: c0)
            let uuid = String(cString: c1)
            let text = String(cString: c2).trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { continue }

            var note: String? = nil
            var style: Int? = nil
            var dateAdded: Date? = nil
            var modified: Date? = nil
            var location: String? = nil

            if let noteIndex = columnIndices["ZANNOTATIONNOTE"], noteIndex < Int(sqlite3_column_count(stmt)) {
                note = sqlite3_column_text(stmt, Int32(noteIndex)).map { String(cString: $0) }
            }
            if let styleIndex = columnIndices["ZANNOTATIONSTYLE"], styleIndex < Int(sqlite3_column_count(stmt)) {
                if sqlite3_column_type(stmt, Int32(styleIndex)) != SQLITE_NULL {
                    style = Int(sqlite3_column_int64(stmt, Int32(styleIndex)))
                }
            }
            if let dateAddedIndex = columnIndices["ZANNOTATIONCREATIONDATE"], dateAddedIndex < Int(sqlite3_column_count(stmt)) {
                if sqlite3_column_type(stmt, Int32(dateAddedIndex)) != SQLITE_NULL {
                    dateAdded = Date(timeIntervalSinceReferenceDate: TimeInterval(sqlite3_column_double(stmt, Int32(dateAddedIndex))))
                }
            }
            if let modifiedIndex = columnIndices["ZANNOTATIONMODIFICATIONDATE"], modifiedIndex < Int(sqlite3_column_count(stmt)) {
                if sqlite3_column_type(stmt, Int32(modifiedIndex)) != SQLITE_NULL {
                    modified = Date(timeIntervalSinceReferenceDate: TimeInterval(sqlite3_column_double(stmt, Int32(modifiedIndex))))
                }
            }
            if let locationIndex = columnIndices["ZANNOTATIONLOCATION"], locationIndex < Int(sqlite3_column_count(stmt)) {
                if sqlite3_column_type(stmt, Int32(locationIndex)) != SQLITE_NULL {
                    location = sqlite3_column_text(stmt, Int32(locationIndex)).map { String(cString: $0) }
                }
            }

            rows.append(HighlightRow(assetId: assetId, uuid: uuid, text: text, note: note, style: style, dateAdded: dateAdded, modified: modified, location: location))
            fetched += 1
        }
        print("Fetched page: limit=\(limit) offset=\(offset) fetched=\(fetched)" + (since != nil ? " since=\(since!)" : ""))
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