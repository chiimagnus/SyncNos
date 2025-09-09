//
//  MainFlow.swift
//  SyncBookNotesWithNotion
//
//  Created by chii_magnus on 2025/9/10.
//

import Foundation

// MARK: - Main Flow

public func runMain() -> ExitCode {
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
        guard let adb = annotationDB, let bdb = booksDB else { 
            return .success 
        }
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
            let filters = Filters(bookSubstrings: options.bookFilters, authorSubstrings: options.authorFilters, assetIds: options.assetFilters)
            let exportData = buildExport(annotations: annotations, books: books, filters: filters)
            if exportData.isEmpty {
                fputs("No books matched filters.\n", stderr)
            }
            try writeJSON(exportData, to: options.outPath, pretty: options.pretty)
            return .success
        } catch {
            fputs("export failed: \(error)\n", stderr)
            return .queryFailed
        }
    case .list:
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
            let filters = Filters(bookSubstrings: options.bookFilters, authorSubstrings: options.authorFilters, assetIds: options.assetFilters)
            // count highlights by asset
            var cnt: [String: Int] = [:]
            for a in annotations { 
                cnt[a.assetId, default: 0] += 1 
            }
            // print filtered list
            let filteredBooks = books.filter { matches(book: $0, filters: filters) }
            for b in filteredBooks.sorted(by: { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }) {
                let c = cnt[b.assetId] ?? 0
                print("\(b.assetId)\t\(c)\t\(b.title)\t\(b.author)")
            }
            if filteredBooks.isEmpty { 
                fputs("No books matched filters.\n", stderr) 
            }
            return .success
        } catch {
            fputs("list failed: \(error)\n", stderr)
            return .queryFailed
        }
    }
}