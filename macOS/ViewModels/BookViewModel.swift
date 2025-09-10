//
//  BookViewModel.swift
//  SyncBookNotesWithNotion
//
//  Created by chii_magnus on 2025/9/10.
//

import Foundation
import SwiftUI

// MARK: - BookViewModel

class BookViewModel: ObservableObject {
    @Published var books: [BookExport] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    private let databaseService = DatabaseService()
    
    // MARK: - Public Methods
    
    func loadBooks() {
        isLoading = true
        errorMessage = nil
        
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            
            do {
                let books = try self.fetchBooksFromDatabase()
                DispatchQueue.main.async {
                    self.books = books
                    self.isLoading = false
                    print("Successfully loaded \(books.count) books")
                }
            } catch {
                let errorDesc = error.localizedDescription
                print("Error loading books: \(errorDesc)")
                DispatchQueue.main.async {
                    self.errorMessage = errorDesc
                    self.isLoading = false
                }
            }
        }
    }
    
    func buildExport(annotations: [HighlightRow], books: [BookRow], filters: Filters?) -> [BookExport] {
        var highlightsByAsset: [String: [Highlight]] = [:]
        for row in annotations {
            highlightsByAsset[row.assetId, default: []].append(Highlight(uuid: row.uuid, text: row.text))
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
            if let f = filters, !self.databaseService.matches(book: b, filters: f) { 
                continue 
            }
            result.append(BookExport(bookId: assetId, authorName: b.author, bookTitle: b.title, ibooksURL: "ibooks://assetid/\(assetId)", highlights: hs))
        }
        let sortedResult = result.sorted { $0.bookTitle.localizedCaseInsensitiveCompare($1.bookTitle) == .orderedAscending }
        print("Built export with \(sortedResult.count) books")
        return sortedResult
    }
    
    // MARK: - Private Methods
    
    private func fetchBooksFromDatabase() throws -> [BookExport] {
        let root = booksDataRoot(dbRootOverride: nil)
        print("Books data root: \(root)")
        
        let annotationDir = (root as NSString).appendingPathComponent("AEAnnotation")
        let booksDir = (root as NSString).appendingPathComponent("BKLibrary")
        
        print("Looking for annotation DB in: \(annotationDir)")
        print("Looking for books DB in: \(booksDir)")
        
        guard let annotationDB = latestSQLiteFile(in: annotationDir) else {
            let error = "Annotation DB not found under \(annotationDir)"
            print("Error: \(error)")
            throw NSError(domain: "SyncBookNotes", code: 10, userInfo: [NSLocalizedDescriptionKey: error])
        }
        print("Found annotation DB: \(annotationDB)")
        
        guard let booksDB = latestSQLiteFile(in: booksDir) else {
            let error = "Books DB not found under \(booksDir)"
            print("Error: \(error)")
            throw NSError(domain: "SyncBookNotes", code: 10, userInfo: [NSLocalizedDescriptionKey: error])
        }
        print("Found books DB: \(booksDB)")
        
        let adbPath = ensureTempCopyIfLocked(originalPath: annotationDB)
        let bdbPath = ensureTempCopyIfLocked(originalPath: booksDB)
        
        print("Using annotation DB copy: \(adbPath)")
        print("Using books DB copy: \(bdbPath)")
        
        let adbH = try databaseService.openReadOnlyDatabase(dbPath: adbPath)
        defer { 
            databaseService.close(adbH)
            print("Closed annotation DB")
        }
        let bdbH = try databaseService.openReadOnlyDatabase(dbPath: bdbPath)
        defer { 
            databaseService.close(bdbH)
            print("Closed books DB")
        }
        
        let annotations = try databaseService.fetchAnnotations(db: adbH)
        print("Fetched \(annotations.count) annotations")
        
        let assetIds = Array(Set(annotations.map { $0.assetId })).sorted()
        print("Found \(assetIds.count) unique asset IDs")
        
        let books = try databaseService.fetchBooks(db: bdbH, assetIds: assetIds)
        print("Fetched \(books.count) books")
        
        let filters = Filters(bookSubstrings: [], authorSubstrings: [], assetIds: [])
        let exportData = buildExport(annotations: annotations, books: books, filters: filters)
        
        return exportData
    }
    
    private func booksDataRoot(dbRootOverride: String?) -> String {
        if let override = dbRootOverride {
            return override
        }
        let home = NSHomeDirectory()
        return "\(home)/Library/Containers/com.apple.iBooksX/Data/Documents"
    }
    
    private func latestSQLiteFile(in dir: String) -> String? {
        let url = URL(fileURLWithPath: dir)
        guard let files = try? FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.contentModificationDateKey]) else {
            print("Failed to list contents of directory: \(dir)")
            return nil
        }
        let sqliteFiles = files.filter { $0.pathExtension == "sqlite" }
        guard !sqliteFiles.isEmpty else {
            print("No SQLite files found in directory: \(dir)")
            return nil
        }
        let sorted = sqliteFiles.sorted { a, b in
            guard let dateA = try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate,
                  let dateB = try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate else {
                return false
            }
            return dateA > dateB
        }
        let latestFile = sorted.first?.path
        print("Latest SQLite file in \(dir): \(latestFile ?? "none")")
        return latestFile
    }
    
    private func ensureTempCopyIfLocked(originalPath: String) -> String {
        let url = URL(fileURLWithPath: originalPath)
        let tempDir = NSTemporaryDirectory()
        let tempURL = URL(fileURLWithPath: tempDir).appendingPathComponent(UUID().uuidString).appendingPathExtension("sqlite")
        
        do {
            try FileManager.default.copyItem(at: url, to: tempURL)
            print("Copied DB from \(originalPath) to \(tempURL.path)")
            return tempURL.path
        } catch {
            print("Failed to copy DB from \(originalPath) to \(tempURL.path): \(error.localizedDescription)")
            return originalPath
        }
    }
}