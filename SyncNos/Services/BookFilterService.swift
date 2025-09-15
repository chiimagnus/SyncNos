import Foundation

// MARK: - Book Filter Service
/// 专门处理书籍过滤逻辑的类，遵循单一职责原则
class BookFilterService {
    
    // MARK: - Filtering Methods
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
}