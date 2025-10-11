import XCTest
@testable import SyncNos

final class MockNotionRequestHelper: NotionRequestHelper {
    private var pages: [[String: Any]]
    private var cursors: [String?]
    private var callCount = 0

    init(pages: [[String: Any]], cursors: [String?] = [nil]) {
        // Use dummy args for super initializer
        let dummyConfig = NotionConfigStore.shared
        let apiBase = URL(string: "https://api.notion.com/v1")!
        let notionVersion = "2022-06-28"
        let logger = DummyLogger()
        self.pages = pages
        self.cursors = cursors
        super.init(configStore: dummyConfig, apiBase: apiBase, notionVersion: notionVersion, logger: logger)
    }

    override func listPageChildren(pageId: String, startCursor: String?, pageSize: Int = 100) async throws -> (results: [[String : Any]], nextCursor: String?) {
        let index = min(callCount, pages.count - 1)
        let results = pages[index]["results"] as? [[String: Any]] ?? []
        let next = cursors[index]
        callCount += 1
        return (results, next)
    }
}

// Minimal dummy logger to satisfy initializer
private final class DummyLogger: LoggerServiceProtocol {
    var currentLevel: LogLevel = .info
    func log(_ level: LogLevel, message: String, file: String, function: String, line: Int) {}
}

final class NotionDatabaseOperationsTests: XCTestCase {
    func test_findDatabasesUnderPage_singlePage_singleDatabase() async throws {
        let child: [String: Any] = ["type": "child_database", "id": "db-1"]
        let page: [String: Any] = ["results": [child]]
        let mock = MockNotionRequestHelper(pages: [page], cursors: [nil])
        let ops = NotionDatabaseOperations(requestHelper: mock)

        let found = try await ops.findDatabasesUnderPage(parentPageId: "page-1")
        XCTAssertEqual(found, ["db-1"])
    }

    func test_findDatabasesUnderPage_multiplePages_multipleDatabases() async throws {
        let child1: [String: Any] = ["type": "child_database", "id": "db-1"]
        let child2: [String: Any] = ["type": "child_database", "id": "db-2"]
        let page1: [String: Any] = ["results": [child1]]
        let page2: [String: Any] = ["results": [child2]]
        let mock = MockNotionRequestHelper(pages: [page1, page2], cursors: ["cursor-1", nil])
        let ops = NotionDatabaseOperations(requestHelper: mock)

        let found = try await ops.findDatabasesUnderPage(parentPageId: "page-1")
        XCTAssertEqual(found.sorted(), ["db-1", "db-2"].sorted())
    }

    func test_findDatabasesUnderPage_noDatabases_returnsEmpty() async throws {
        let page: [String: Any] = ["results": [["type": "paragraph", "id": "blk-1"]]]
        let mock = MockNotionRequestHelper(pages: [page], cursors: [nil])
        let ops = NotionDatabaseOperations(requestHelper: mock)

        let found = try await ops.findDatabasesUnderPage(parentPageId: "page-1")
        XCTAssertTrue(found.isEmpty)
    }
}
