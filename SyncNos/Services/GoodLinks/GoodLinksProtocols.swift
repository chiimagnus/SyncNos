import Foundation
import SQLite3

// MARK: - GoodLinks Service Protocols

protocol GoodLinksDatabaseServiceProtocol {
    func defaultDatabasePath() -> String
    func canOpenReadOnly(dbPath: String) -> Bool
    func openReadOnlyDatabase(dbPath: String) throws -> OpaquePointer
    func close(_ db: OpaquePointer?)
    func makeReadOnlySession(dbPath: String) throws -> GoodLinksReadOnlySessionProtocol
}

protocol GoodLinksReadOnlySessionProtocol: AnyObject {
    func fetchRecentLinks(limit: Int) throws -> [GoodLinksLinkRow]
    func fetchHighlights(limit: Int, offset: Int) throws -> [GoodLinksHighlightRow]
    func fetchHighlightsForLink(linkId: String, limit: Int, offset: Int) throws -> [GoodLinksHighlightRow]
    func fetchHighlightCountsByLink() throws -> [GoodLinksLinkHighlightCount]
    func close()
}


