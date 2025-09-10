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
                }
            } catch {
                DispatchQueue.main.async {
                    self.errorMessage = error.localizedDescription
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
        return result.sorted { $0.bookTitle.localizedCaseInsensitiveCompare($1.bookTitle) == .orderedAscending }
    }
    
    // MARK: - Private Methods
    
    private func fetchBooksFromDatabase() throws -> [BookExport] {
        let root = booksDataRoot(dbRootOverride: nil)
        let annotationDir = (root as NSString).appendingPathComponent("AEAnnotation")
        let booksDir = (root as NSString).appendingPathComponent("BKLibrary")
        guard let annotationDB = latestSQLiteFile(in: annotationDir) else {
            throw NSError(domain: "SyncBookNotes", code: 10, userInfo: [NSLocalizedDescriptionKey: "Annotation DB not found under \(annotationDir)"])
        }
        guard let booksDB = latestSQLiteFile(in: booksDir) else {
            throw NSError(domain: "SyncBookNotes", code: 10, userInfo: [NSLocalizedDescriptionKey: "Books DB not found under \(booksDir)"])
        }
        
        let adbPath = ensureTempCopyIfLocked(originalPath: annotationDB)
        let bdbPath = ensureTempCopyIfLocked(originalPath: booksDB)
        
        let adbH = try databaseService.openReadOnlyDatabase(dbPath: adbPath)
        defer { databaseService.close(adbH) }
        let bdbH = try databaseService.openReadOnlyDatabase(dbPath: bdbPath)
        defer { databaseService.close(bdbH) }
        
        let annotations = try databaseService.fetchAnnotations(db: adbH)
        let assetIds = Array(Set(annotations.map { $0.assetId })).sorted()
        let books = try databaseService.fetchBooks(db: bdbH, assetIds: assetIds)
        
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
            return nil
        }
        let sqliteFiles = files.filter { $0.pathExtension == "sqlite" }
        guard !sqliteFiles.isEmpty else {
            return nil
        }
        let sorted = sqliteFiles.sorted { a, b in
            guard let dateA = try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate,
                  let dateB = try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate else {
                return false
            }
            return dateA > dateB
        }
        return sorted.first?.path
    }
    
    private func ensureTempCopyIfLocked(originalPath: String) -> String {
        let url = URL(fileURLWithPath: originalPath)
        let tempDir = NSTemporaryDirectory()
        let tempURL = URL(fileURLWithPath: tempDir).appendingPathComponent(UUID().uuidString).appendingPathExtension("sqlite")
        
        do {
            try FileManager.default.copyItem(at: url, to: tempURL)
            return tempURL.path
        } catch {
            return originalPath
        }
    }
}