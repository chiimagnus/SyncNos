import Foundation

final class NotionService: NotionServiceProtocol {
    private let configStore: NotionConfigStoreProtocol
    private let apiBase = URL(string: "https://api.notion.com/v1/")!
    private let notionVersion = "2022-06-28"
    
    init(configStore: NotionConfigStoreProtocol) {
        self.configStore = configStore
    }
    
    // MARK: - Public API
    func createDatabase(title: String) async throws -> NotionDatabase {
        guard let pageId = configStore.notionPageId, let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        
        let url = apiBase.appendingPathComponent("databases")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        addCommonHeaders(to: &request, key: key)
        
        let body: [String: Any] = [
            "parent": [
                "type": "page_id",
                "page_id": pageId
            ],
            "title": [[
                "type": "text",
                "text": ["content": title]
            ]],
            "properties": [
                "Name": ["title": [:]]
            ]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureSuccess(response: response, data: data)
        return try JSONDecoder().decode(NotionDatabase.self, from: data)
    }
    
    func createPage(databaseId: String, pageTitle: String, header: String?) async throws -> NotionPage {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        
        let url = apiBase.appendingPathComponent("pages")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        addCommonHeaders(to: &request, key: key)
        
        var children: [[String: Any]] = []
        if let header = header, !header.isEmpty {
            children = [[
                "object": "block",
                "heading_2": [
                    "rich_text": [[
                        "text": ["content": header]
                    ]]
                ]
            ]]
        }
        
        let body: [String: Any] = [
            "parent": [
                "type": "database_id",
                "database_id": databaseId
            ],
            "properties": [
                "Name": [
                    "title": [[
                        "text": ["content": pageTitle]
                    ]]
                ]
            ],
            "children": children
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureSuccess(response: response, data: data)
        return try JSONDecoder().decode(NotionPage.self, from: data)
    }
    
    func appendParagraph(pageId: String, content: String) async throws -> NotionAppendResult {
        guard let key = configStore.notionKey else {
            throw NSError(domain: "NotionService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Notion not configured"])
        }
        
        let url = apiBase.appendingPathComponent("blocks/\(pageId)/children")
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        addCommonHeaders(to: &request, key: key)
        
        let body: [String: Any] = [
            "children": [[
                "paragraph": [
                    "rich_text": [["text": ["content": content]]]
                ]
            ]]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureSuccess(response: response, data: data)
        return try JSONDecoder().decode(NotionAppendResult.self, from: data)
    }
    
    // MARK: - Helpers
    private func addCommonHeaders(to request: inout URLRequest, key: String) {
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue(notionVersion, forHTTPHeaderField: "Notion-Version")
    }
    
    private static func ensureSuccess(response: URLResponse, data: Data) throws {
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "NotionService", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "HTTP \(http.statusCode): \(body)"])
        }
    }
}


