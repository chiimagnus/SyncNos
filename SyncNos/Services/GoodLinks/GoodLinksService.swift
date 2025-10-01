import Foundation
import SQLite3

// MARK: - GoodLinks Read-only Session

final class GoodLinksReadOnlySession: GoodLinksReadOnlySessionProtocol {
    private let db: OpaquePointer
    private let connection: GoodLinksConnectionService
    private let query: GoodLinksQueryService

    init(dbPath: String, connection: GoodLinksConnectionService = GoodLinksConnectionService(), query: GoodLinksQueryService = GoodLinksQueryService()) throws {
        self.connection = connection
        self.query = query
        self.db = try connection.openReadOnlyDatabase(dbPath: dbPath)
    }

    func fetchRecentLinks(limit: Int) throws -> [GoodLinksLinkRow] {
        try query.fetchRecentLinks(db: db, limit: limit)
    }

    func fetchHighlights(limit: Int, offset: Int) throws -> [GoodLinksHighlightRow] {
        try query.fetchHighlights(db: db, limit: limit, offset: offset)
    }

    func fetchHighlightsForLink(linkId: String, limit: Int, offset: Int) throws -> [GoodLinksHighlightRow] {
        try query.fetchHighlightsForLink(db: db, linkId: linkId, limit: limit, offset: offset)
    }

    func fetchHighlightCountsByLink() throws -> [GoodLinksLinkHighlightCount] {
        try query.fetchHighlightCountsByLink(db: db)
    }

    func close() {
        connection.close(db)
    }
}

// MARK: - GoodLinks Database Service

final class GoodLinksDatabaseService: GoodLinksDatabaseServiceProtocol, GoodLinksDatabaseServiceExposed {
    private let connection = GoodLinksConnectionService()

    func defaultDatabasePath() -> String {
        connection.defaultDatabasePath()
    }

    func canOpenReadOnly(dbPath: String) -> Bool {
        connection.canOpenReadOnly(dbPath: dbPath)
    }

    func openReadOnlyDatabase(dbPath: String) throws -> OpaquePointer {
        try connection.openReadOnlyDatabase(dbPath: dbPath)
    }

    func close(_ db: OpaquePointer?) {
        connection.close(db)
    }

    func makeReadOnlySession(dbPath: String) throws -> GoodLinksReadOnlySessionProtocol {
        try GoodLinksReadOnlySession(dbPath: dbPath)
    }
}


