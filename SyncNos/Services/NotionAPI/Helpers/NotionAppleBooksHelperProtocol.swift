import Foundation

protocol NotionAppleBooksHelperProtocol {
    func buildIBooksLink(bookId: String, location: String?) -> String
    func buildMetadataString(for highlight: HighlightRow) -> String
    func buildHighlightProperties(bookId: String, bookTitle: String, author: String, highlight: HighlightRow, clearEmpty: Bool) -> [String: Any]
    func buildHighlightRichText(for highlight: HighlightRow, bookId: String, maxTextLength: Int?) -> [[String: Any]]
    func buildHighlightChildren(bookId: String, highlight: HighlightRow) -> [[String: Any]]
    func styleName(for style: Int) -> String
    func perBookDatabaseProperties(bookTitle: String, author: String, assetId: String) -> (title: String, properties: [String: Any])
    func buildBookPageProperties(bookTitle: String, author: String, assetId: String, urlString: String?, header: String?) -> (properties: [String: Any], children: [[String: Any]])
}

// Convenience default implementations to reduce call-site verbosity
extension NotionAppleBooksHelperProtocol {
    func buildHighlightRichText(for highlight: HighlightRow, bookId: String) -> [[String: Any]] {
        return buildHighlightRichText(for: highlight, bookId: bookId, maxTextLength: nil)
    }

    func buildHighlightProperties(bookId: String, bookTitle: String, author: String, highlight: HighlightRow) -> [String: Any] {
        return buildHighlightProperties(bookId: bookId, bookTitle: bookTitle, author: author, highlight: highlight, clearEmpty: false)
    }
}
