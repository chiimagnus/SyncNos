# NOTION INTEGRATION

这份文档为 `SyncBookNotesWithNotion` 项目提供完整的 Notion API 接入与模板使用指南，包含概念、认证方式、核心端点、错误处理、分页/速率限制、文件处理、Swift/macOS 示例代码、以及模板设计与程序化使用方法。

> 重要：以 `https://developers.notion.com/` 的官方文档为准，本文档基于官方文档与公开资料整理，可能随 Notion API 更新而变化。

目录
 - 概览与用途
 - 认证方式（内部集成 vs OAuth）
 - 创建集成与授权步骤
 - HTTP 请求要点（Headers / Base URL / 版本）
 - 核心端点与常用示例
 - 分页、速率限制与重试策略
 - 文件与附件处理建议
 - 错误处理、幂等性与最佳实践
 - Swift/macOS 集成设计建议（代码示例）
 - Notion 模板：UI 操作、导出/共享、程序化模板 JSON
 - 书籍笔记模板示例（数据库 schema 与 children blocks）
 - 测试、部署与安全建议
 - 项目内操作清单（Actionable TODO）


概览与用途
----------------
- Notion API 可编程地管理 `pages`、`databases`、`blocks`、`users` 等资源，适合在 `SyncBookNotesWithNotion` 中自动把书籍笔记、书签或元数据同步到 Notion。
- 使用场景：自动化创建读书笔记页面、把摘录作为 blocks 写入、在数据库中维护书籍状态与评分等。


认证方式（内部集成 vs OAuth）
----------------
- 内部集成（Internal Integration）：适合单一工作区或个人使用，由工作区管理员创建并颁发固定 `Integration Token`（Bearer token）。实现简单，推荐用于仅你/你所在工作区使用的工具。
- OAuth 2.0：适合多用户/多工作区授权的公开应用。实现较复杂，需要完成 OAuth 授权码流程并安全存储 access token 与 refresh token。


创建集成与授权步骤
----------------
1. 登录 Notion，访问 `开发者 > My Integrations`（或 `https://www.notion.so/my-integrations`），点击 **+ New integration**。
2. 填写名称、关联 workspace，选择权限范围（read/write），创建后保存 `Internal Integration Token`。
3. 在 Notion UI 中打开目标 Page/Database，点击右上角 `Share` → `Add people, emails, groups, or integrations` → 选择你的集成，把集成添加为协作者。
4. 提取目标 `database_id` 或 `page_id`（可从 Notion URL 中获取长 ID）。


HTTP 请求要点（Headers / Base URL / 版本）
----------------
- Base URL: `https://api.notion.com/v1/`
- 必要请求头：
  - `Authorization: Bearer <INTEGRATION_TOKEN>`
  - `Notion-Version: <YYYY-MM-DD>`（推荐固定版本号以避免 API 突变）
  - `Content-Type: application/json`（POST/PUT/PATCH 请求）
- 响应状态：200/201 成功；400/401/403/404 等客户端错误；429 速率限制（含 `Retry-After`）；5xx 服务器错误。


核心端点与常用示例
----------------
- `GET /pages/{page_id}` — 获取页面元数据。
- `POST /pages` — 创建页面（parent 可设为 `database_id`，并传 `properties` 和 `children` blocks）。
- `PATCH /pages/{page_id}` — 更新页面属性。
- `POST /databases/{database_id}/query` — 查询数据库（支持 filter/sort/pagination）。
- `PATCH /databases/{database_id}` — 更新数据库 schema（属性）。
- `GET /blocks/{block_id}/children` — 列出某个块的子块（支持分页）。
- `PATCH /blocks/{block_id}/children`, `POST /blocks/{block_id}/children` — 修改/追加子块。
- `POST /search` — 全站或工作区搜索（可按 object type 过滤）。

示例：查询数据库（curl）

```bash
curl -X POST 'https://api.notion.com/v1/databases/<DATABASE_ID>/query' \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{}'
```

示例：创建页面（curl）

```bash
curl -X POST 'https://api.notion.com/v1/pages' \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": { "database_id": "<DATABASE_ID>" },
    "properties": {
      "Name": {
        "title": [
          { "text": { "content": "书名示例" } }
        ]
      },
      "Author": {
        "rich_text": [
          { "text": { "content": "作者名" } }
        ]
      }
    },
    "children": [
      { "object": "block", "type": "paragraph", "paragraph": { "text": [{ "type": "text", "text": { "content": "笔记正文..." } }] } }
    ]
  }'
```


分页、速率限制与重试策略
----------------
- 分页：`databases/query`、`blocks/children` 等端点返回 `has_more` 与 `next_cursor`。使用 `start_cursor` + `page_size` 循环获取全部数据。
- 速率限制：官方未公开精确 QPS，但当被限流时 API 返回 429 并带 `Retry-After`（秒）。
- 推荐策略：
  - 对 429 使用指数退避（exponential backoff）并尊重 `Retry-After`。
  - 写操作避免无条件重试；若无法保证幂等性，记录失败并人工或异步补偿。
  - 批量写入时拆分批次并间隔发送以降低被限流风险。


文件与附件处理建议
----------------
- Notion 的文件引用支持 `external`（外部 URL）与 `file`（Notion 托管，视具体 API 支持情况而定）。
- 推荐流程：先把附件上传到你控制的存储（S3、CDN），然后在 Notion 中使用 `external` 引用该 URL，兼容性最好也便于管理访问权限。


错误处理、幂等性与最佳实践
----------------
- 写操作建议：为每个要写入的书籍或笔记维护唯一标识（如 `BookID`），用于幂等判断，防止重复创建。
- 把大文本拆成多个 blocks（paragraph/toggle/quote）以避免超长单块问题。
- 批量操作用队列和补偿逻辑（dead-letter、retry queue）保证最终一致性。


Swift/macOS 集成设计建议（代码示例）
----------------
- 文件：建议在 `macOS/Services/NotionService.swift` 实现一个 `NotionClient`，并在 `macOS/DIContainer.swift` 注入。
- Token 管理：不要把 token 写在代码中，开发用环境变量或 macOS Keychain，CI/CD 用 Secrets。 
- Core API 方法（建议）：
  - `queryDatabase(databaseId: String)`
  - `createPage(in databaseId: String, properties: NotionProperties, children: [NotionBlock])`
  - `appendBlocks(parentBlockId: String, blocks: [NotionBlock])`
  - `getBlocks(parentBlockId: String, startCursor: String?)`

示例（简化的 NotionClient）：

```swift
import Foundation

final class NotionClient {
    private let token: String
    private let session: URLSession
    private let apiVersion = "2022-06-28"

    init(token: String, session: URLSession = .shared) {
        self.token = token
        self.session = session
    }

    private func request(_ path: String, method: String = "GET", body: Data? = nil) -> URLRequest {
        var req = URLRequest(url: URL(string: "https://api.notion.com/v1\(path)")!)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue(apiVersion, forHTTPHeaderField: "Notion-Version")
        if body != nil { req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        req.httpBody = body
        return req
    }

    func queryDatabase(databaseId: String, body: [String: Any] = [:], completion: @escaping (Result<Data, Error>) -> Void) {
        let path = "/databases/\(databaseId)/query"
        let jsonData = try? JSONSerialization.data(withJSONObject: body)
        let req = request(path, method: "POST", body: jsonData)
        session.dataTask(with: req) { data, resp, err in
            if let err = err { completion(.failure(err)); return }
            guard let http = resp as? HTTPURLResponse else { completion(.failure(NSError())); return }
            if http.statusCode == 429, let retry = http.allHeaderFields["Retry-After"] as? String {
                completion(.failure(NSError(domain: "Notion", code: 429, userInfo: ["retryAfter": retry])))
                return
            }
            guard let data = data else { completion(.failure(NSError())); return }
            completion(.success(data))
        }.resume()
    }

    func createPage(in databaseId: String, properties: [String: Any], children: [[String: Any]]? = nil, completion: @escaping (Result<Data, Error>) -> Void) {
        let path = "/pages"
        var payload: [String: Any] = [
            "parent": ["database_id": databaseId],
            "properties": properties
        ]
        if let children = children { payload["children"] = children }
        let jsonData = try? JSONSerialization.data(withJSONObject: payload)
        let req = request(path, method: "POST", body: jsonData)
        session.dataTask(with: req) { data, resp, err in
            if let err = err { completion(.failure(err)); return }
            guard let data = data else { completion(.failure(NSError())); return }
            completion(.success(data))
        }.resume()
    }
}
```

注：实际生产代码应使用 `async/await`、类型安全 `Codable`、更完整的错误模型以及可注入的重试策略。


Notion 模板：UI 操作、导出/共享、程序化模板 JSON
----------------
- UI 创建模板：
  - 单页模板：直接创建页面并设计好结构；通过 `Share` → `Copy link` 或 `Share to web` 并勾选 `Allow duplicate as template` 来分享模板。 
  - 数据库模板：打开数据库 → `New` 下拉 → `+ New template` 来创建数据库级模板，配置默认属性与 children。 
- 导出：页面可 `Export` 为 Markdown/HTML/PDF，数据库可导出为 CSV（仅数据）。注意导出可能无法保留复杂块间的全部语义。
- 程序化模板（推荐用于自动化）：在服务端维护 JSON 模板（`properties` + `children`），在需要创建页面时把占位符替换为真实内容并 `POST /pages`。


书籍笔记模板示例（建议 schema）
----------------
- Database 属性建议：
  - `Name` (title)
  - `Author` (rich_text)
  - `Status` (select) — 未读/阅读中/已读
  - `Tags` (multi_select)
  - `Rating` (number)
  - `Notes` (rich_text) — 简要
  - `BookID` (text) — 你系统的唯一 ID，用于幂等
  - `CreatedAt`, `UpdatedAt` (date)
- 模板 children 建议：
  - `Heading 2` — 摘要
  - `Paragraph` — 摘要正文
  - `Heading 3` — 精选摘录
  - 一系列 `Quote` 或 `Toggle` blocks 放摘录或笔记片段

程序化 JSON 模板（简化示例，创建前替换占位符）

```json
{
  "properties": {
    "Name": { "title": [{ "text": { "content": "{{BOOK_TITLE}}" } }] },
    "Author": { "rich_text": [{ "text": { "content": "{{BOOK_AUTHOR}}" } }] },
    "Status": { "select": { "name": "已读" } },
    "BookID": { "rich_text": [{ "text": { "content": "{{BOOK_ID}}" } }] }
  },
  "children": [
    { "object": "block", "type": "heading_2", "heading_2": { "text": [{ "type":"text","text": {"content": "摘要"}}] } },
    { "object": "block", "type": "paragraph", "paragraph": { "text": [{ "type":"text","text": {"content":"{{SUMMARY}}"}}] } }
  ]
}
```


测试、部署与安全建议
----------------
- Postman/curl 先行调试 API schema，再在 Swift 中实现客户端。
- 保存 token：开发时用环境变量或 Keychain，CI/CD 用 Secrets 管理。不要硬编码到仓库。
- 最小权限原则：仅给集成需要访问的页面/数据库权限。


项目内操作清单（Actionable TODOs）
----------------
1. 在 Notion 创建内部集成并拿到 token。
2. 在 Notion UI 给目标数据库添加该集成为协作者。
3. 在 `macOS/Services/` 新增 `NotionService.swift`，实现 `NotionClient` 并注入 `DIContainer.swift`。
4. 在 `macOS/ViewModels/BookDetailViewModel.swift` 添加 `syncToNotion()` 并实现调用逻辑、错误展示与进度指示。
5. 准备 JSON 模板并实现 `createPage(fromTemplate:withData:)`。
6. 用 Postman 进行端到端测试，处理 429 与重试逻辑。


附录：参考链接
----------------
- Notion 官方文档: `https://developers.notion.com/`
- Notion 模板库: `https://www.notion.so/templates`

---

如果你希望我现在把 `NotionService.swift` 直接实现到项目中并做最小集成测试（或把这份文档作为 git commit 提交），请回复“实现 NotionService” 或 “提交文档”。

