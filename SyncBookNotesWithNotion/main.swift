//
//  main.swift
//  SyncBookNotesWithNotion
//
//  Created by chii_magnus on 2025/9/10.
//

import Foundation
import SQLite3

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

// MARK: - Exit Codes

enum ExitCode: Int32 {
    case success = 0
    case argumentError = 2
    case dbOpenFailed = 10
    case queryFailed = 20
}

// MARK: - CLI Arguments

struct CLIOptions {
    enum Command: String { case inspect, export }

    var command: Command = .export
    var dbRootOverride: String?
    var outPath: String?
    var pretty: Bool = false
}

func parseArguments(_ args: [String]) -> CLIOptions {
    var options = CLIOptions()
    var index = 1
    if index < args.count, let cmd = CLIOptions.Command(rawValue: args[index]) {
        options.command = cmd
        index += 1
    }
    while index < args.count {
        let a = args[index]
        switch a {
        case "--db-root":
            if index + 1 < args.count { options.dbRootOverride = args[index + 1]; index += 2 } else { index += 1 }
        case "--out":
            if index + 1 < args.count { options.outPath = args[index + 1]; index += 2 } else { index += 1 }
        case "--pretty":
            options.pretty = true; index += 1
        default:
            // Ignore unknown for M0 to keep零依赖
            index += 1
        }
    }
    return options
}

// MARK: - FS Utilities

func homeDirectory() -> String {
    NSHomeDirectory()
}

func booksDataRoot(dbRootOverride: String?) -> String {
    if let override = dbRootOverride { return override }
    return homeDirectory() + "/Library/Containers/com.apple.iBooksX/Data/Documents"
}

func latestSQLiteFile(in directory: String) -> String? {
    let fm = FileManager.default
    guard let contents = try? fm.contentsOfDirectory(atPath: directory) else { return nil }
    let candidates = contents.filter { $0.hasSuffix(".sqlite") }
    guard !candidates.isEmpty else { return nil }
    var best: (path: String, mtime: Date)?
    for file in candidates {
        let full = (directory as NSString).appendingPathComponent(file)
        if let attrs = try? fm.attributesOfItem(atPath: full), let mtime = attrs[.modificationDate] as? Date {
            if best == nil || mtime > best!.mtime { best = (full, mtime) }
        } else {
            // fallback: prefer lexicographically last if no mtime
            if best == nil { best = (full, Date.distantPast) }
        }
    }
    return best?.path
}

func ensureTempCopyIfLocked(originalPath: String) -> String {
    // Try open read-only first; if fails, copy to /tmp and use the copy
    if canOpenReadOnly(dbPath: originalPath) {
        return originalPath
    }
    let tmp = (NSTemporaryDirectory() as NSString).appendingPathComponent(UUID().uuidString + ".sqlite")
    do {
        let fm = FileManager.default
        try fm.copyItem(atPath: originalPath, toPath: tmp)
        return tmp
    } catch {
        return originalPath // last resort, let open fail and report
    }
}

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
        throw NSError(domain: "SyncBookNotes", code: Int(ExitCode.dbOpenFailed.rawValue), userInfo: [NSLocalizedDescriptionKey: "Failed to open SQLite database at \(dbPath) (rc=\(rc))"])
    }
    return handle
}

func finalize(_ stmt: OpaquePointer?) {
    if let s = stmt { sqlite3_finalize(s) }
}

func close(_ db: OpaquePointer?) {
    if let d = db { sqlite3_close(d) }
}

// MARK: - Queries

struct HighlightRow { let assetId: String; let uuid: String; let text: String }
struct BookRow { let assetId: String; let author: String; let title: String }

func fetchAnnotations(db: OpaquePointer) throws -> [HighlightRow] {
    let sql = "SELECT ZANNOTATIONASSETID,ZANNOTATIONUUID,ZANNOTATIONSELECTEDTEXT FROM ZAEANNOTATION WHERE ZANNOTATIONDELETED=0 AND ZANNOTATIONSELECTEDTEXT NOT NULL;"
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
        throw NSError(domain: "SyncBookNotes", code: Int(ExitCode.queryFailed.rawValue), userInfo: [NSLocalizedDescriptionKey: "Prepare failed: annotations"])
    }
    defer { finalize(stmt) }
    var rows: [HighlightRow] = []
    while sqlite3_step(stmt) == SQLITE_ROW {
        guard let c0 = sqlite3_column_text(stmt, 0), let c1 = sqlite3_column_text(stmt, 1), let c2 = sqlite3_column_text(stmt, 2) else { continue }
        let assetId = String(cString: c0)
        let uuid = String(cString: c1)
        let text = String(cString: c2).trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { continue }
        rows.append(HighlightRow(assetId: assetId, uuid: uuid, text: text))
    }
    return rows
}

func fetchBooks(db: OpaquePointer, assetIds: [String]) throws -> [BookRow] {
    guard !assetIds.isEmpty else { return [] }
    let placeholders = Array(repeating: "?", count: assetIds.count).joined(separator: ",")
    let sql = "SELECT ZASSETID,ZAUTHOR,ZTITLE FROM ZBKLIBRARYASSET WHERE ZASSETID IN (\(placeholders));"
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
        throw NSError(domain: "SyncBookNotes", code: Int(ExitCode.queryFailed.rawValue), userInfo: [NSLocalizedDescriptionKey: "Prepare failed: books"])
    }
    defer { finalize(stmt) }
    for (i, id) in assetIds.enumerated() {
        sqlite3_bind_text(stmt, Int32(i + 1), id, -1, SQLITE_TRANSIENT)
    }
    var rows: [BookRow] = []
    while sqlite3_step(stmt) == SQLITE_ROW {
        guard let c0 = sqlite3_column_text(stmt, 0), let c1 = sqlite3_column_text(stmt, 1), let c2 = sqlite3_column_text(stmt, 2) else { continue }
        rows.append(BookRow(assetId: String(cString: c0), author: String(cString: c1), title: String(cString: c2)))
    }
    return rows
}

// MARK: - Export

func buildExport(annotations: [HighlightRow], books: [BookRow]) -> [BookExport] {
    var highlightsByAsset: [String: [Highlight]] = [:]
    for row in annotations {
        highlightsByAsset[row.assetId, default: []].append(Highlight(uuid: row.uuid, text: row.text))
    }
    var booksIndex: [String: BookRow] = [:]
    for b in books { booksIndex[b.assetId] = b }
    var result: [BookExport] = []
    for (assetId, hs) in highlightsByAsset {
        guard let b = booksIndex[assetId] else { continue }
        result.append(BookExport(bookId: assetId, authorName: b.author, bookTitle: b.title, ibooksURL: "ibooks://assetid/\(assetId)", highlights: hs))
    }
    return result.sorted { $0.bookTitle.localizedCaseInsensitiveCompare($1.bookTitle) == .orderedAscending }
}

func writeJSON(_ data: [BookExport], to outPath: String?, pretty: Bool) throws {
    let encoder = JSONEncoder()
    if pretty { encoder.outputFormatting = [.prettyPrinted, .sortedKeys] }
    let bytes = try encoder.encode(data)
    if let path = outPath {
        try bytes.write(to: URL(fileURLWithPath: path), options: .atomic)
    } else {
        if let s = String(data: bytes, encoding: .utf8) { print(s) }
    }
}

// MARK: - Inspect helpers

func countRows(db: OpaquePointer, table: String) -> Int? {
    var stmt: OpaquePointer?
    let sql = "SELECT COUNT(*) FROM \(table)"
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
    defer { finalize(stmt) }
    if sqlite3_step(stmt) == SQLITE_ROW { return Int(sqlite3_column_int64(stmt, 0)) }
    return nil
}

// MARK: - Main Flow

func main() -> ExitCode {
    let options = parseArguments(CommandLine.arguments)

    let root = booksDataRoot(dbRootOverride: options.dbRootOverride)
    let annotationDir = (root as NSString).appendingPathComponent("AEAnnotation")
    let booksDir = (root as NSString).appendingPathComponent("BKLibrary")
    let annotationDB = latestSQLiteFile(in: annotationDir)
    let booksDB = latestSQLiteFile(in: booksDir)

    switch options.command {
    case .inspect:
        print("Books data root: \(root)")
        print("AEAnnotation dir: \(annotationDir)")
        print("BKLibrary   dir: \(booksDir)")
        print("AEAnnotation DB: \(annotationDB ?? "<not found>")")
        print("BKLibrary   DB: \(booksDB ?? "<not found>")")
        guard let adb = annotationDB, let bdb = booksDB else { return .success }
        let adbPath = ensureTempCopyIfLocked(originalPath: adb)
        let bdbPath = ensureTempCopyIfLocked(originalPath: bdb)
        do {
            let adbH = try openReadOnlyDatabase(dbPath: adbPath)
            defer { close(adbH) }
            let bdbH = try openReadOnlyDatabase(dbPath: bdbPath)
            defer { close(bdbH) }
            let aCount = countRows(db: adbH, table: "ZAEANNOTATION") ?? -1
            let bCount = countRows(db: bdbH, table: "ZBKLIBRARYASSET") ?? -1
            print("ZAEANNOTATION count: \(aCount)")
            print("ZBKLIBRARYASSET count: \(bCount)")
            return .success
        } catch {
            fputs("inspect failed: \(error)\n", stderr)
            return .dbOpenFailed
        }

    case .export:
        guard let adb = annotationDB else {
            fputs("Annotation DB not found under \(annotationDir)\n", stderr)
            return .dbOpenFailed
        }
        guard let bdb = booksDB else {
            fputs("Books DB not found under \(booksDir)\n", stderr)
            return .dbOpenFailed
        }
        let adbPath = ensureTempCopyIfLocked(originalPath: adb)
        let bdbPath = ensureTempCopyIfLocked(originalPath: bdb)
        do {
            let adbH = try openReadOnlyDatabase(dbPath: adbPath)
            defer { close(adbH) }
            let bdbH = try openReadOnlyDatabase(dbPath: bdbPath)
            defer { close(bdbH) }
            let annotations = try fetchAnnotations(db: adbH)
            let assetIds = Array(Set(annotations.map { $0.assetId })).sorted()
            let books = try fetchBooks(db: bdbH, assetIds: assetIds)
            let exportData = buildExport(annotations: annotations, books: books)
            try writeJSON(exportData, to: options.outPath, pretty: options.pretty)
            return .success
        } catch {
            fputs("export failed: \(error)\n", stderr)
            return .queryFailed
        }
    }
}

let code = main()
exit(code.rawValue)

