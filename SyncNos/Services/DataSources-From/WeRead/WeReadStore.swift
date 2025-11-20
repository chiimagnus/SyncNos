import Foundation

final class WeReadStore: @unchecked Sendable {
    private let fileURL: URL
    private let queue = DispatchQueue(label: "com.syncnos.wereadstore", attributes: .concurrent)
    private let logger: LoggerServiceProtocol

    // In-memory cache
    private var books: [String: WeReadBook] = [:]

    init(logger: LoggerServiceProtocol) {
        self.logger = logger
        
        let fileManager = FileManager.default
        guard let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            fatalError("Could not find Application Support directory")
        }
        
        let appDir = appSupport.appendingPathComponent("SyncNos", isDirectory: true)
        // Ensure directory exists
        try? fileManager.createDirectory(at: appDir, withIntermediateDirectories: true, attributes: nil)
        
        self.fileURL = appDir.appendingPathComponent("weReadStore.json")
        
        self.load()
    }
    
    private func load() {
        queue.sync(flags: .barrier) {
            do {
                guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
                let data = try Data(contentsOf: fileURL)
                let decoder = JSONDecoder()
                let loadedBooks = try decoder.decode([WeReadBook].self, from: data)
                self.books = Dictionary(uniqueKeysWithValues: loadedBooks.map { ($0.bookId, $0) })
                logger.info("Loaded \(self.books.count) WeRead books from store.")
            } catch {
                logger.error("Failed to load WeRead store: \(error)")
                self.books = [:]
            }
        }
    }
    
    private func save() {
        // Must be called within barrier block or handle locking internally.
        // Here we assume the caller (upsert methods) has already acquired the barrier.
        let booksToSave = Array(self.books.values)
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = .prettyPrinted
            let data = try encoder.encode(booksToSave)
            try data.write(to: self.fileURL, options: .atomic)
        } catch {
            logger.error("Failed to save WeRead store: \(error)")
        }
    }
    
    func getBook(id: String) -> WeReadBook? {
        queue.sync {
            return books[id]
        }
    }
    
    func getAllBooks() -> [WeReadBook] {
        queue.sync {
            return Array(books.values)
        }
    }
    
    func upsertBook(_ book: WeReadBook) {
        queue.sync(flags: .barrier) {
            books[book.bookId] = book
            save()
        }
    }
    
    func upsertBooks(_ booksToUpsert: [WeReadBook]) {
        queue.sync(flags: .barrier) {
            for book in booksToUpsert {
                books[book.bookId] = book
            }
            save()
        }
    }
}

