# GoodLinks URL 文章获取功能实现方案（Plan A）

## 背景

目前 SyncNos 从 GoodLinks app 的 SQLite 数据库中读取文章内容（`content` 表），但存在以下问题：
1. GoodLinks 数据库中的 `content` 字段可能为空或不完整
2. 数据库中存储的内容可能是经过处理的（HTML、Markdown 等）
3. 无法获取最新的文章内容（需要 GoodLinks app 先抓取）

**解决方案**：实现 URL 文章直接抓取功能，类似于 WeRead/Dedao 的登录机制，支持：
- 直接从 URL 获取文章内容（主流模式：Reader Mode 提取正文）
- 支持需要登录的网站（WebKit 登录，类似 WeRead/Dedao）
- 智能回退：优先使用数据库内容，失败时尝试 URL 抓取

---

## 优先级分级与详细实现计划

### P0: 架构设计与基础模型（准备阶段）

**目标**: 定义清晰的架构和数据模型，为后续实现打下基础

#### P0.1: 定义服务协议和数据模型
**文件**: `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksURLFetcher.swift`（新建）

**任务**:
1. 创建 `GoodLinksURLFetcherProtocol` 协议
   - `fetchArticle(url: String) async throws -> ArticleFetchResult`
   - `fetchArticleWithAuth(url: String, cookies: [HTTPCookie]) async throws -> ArticleFetchResult`

2. 定义数据模型（在 `GoodLinksModels.swift` 中扩展）:
   ```swift
   /// 文章抓取结果
   struct ArticleFetchResult: Equatable {
       let title: String?
       let content: String      // HTML or Markdown
       let textContent: String  // 纯文本（用于搜索和同步）
       let author: String?
       let publishedDate: Date?
       let wordCount: Int
       let fetchedAt: Date
       let source: FetchSource  // .database, .url, .urlWithAuth
   }
   
   enum FetchSource: String, Codable {
       case database      // 从 GoodLinks 数据库获取
       case url           // 从 URL 直接获取（无需登录）
       case urlWithAuth   // 从 URL 获取（需要登录）
   }
   
   /// URL 抓取错误
   enum URLFetchError: LocalizedError {
       case invalidURL
       case networkError(Error)
       case authenticationRequired
       case parsingFailed
       case contentNotFound
       case rateLimited
   }
   ```

**验证**: 
- 编译通过，没有语法错误
- 协议和模型定义清晰，符合项目 MVVM 架构

---

### P1: 基础 URL 抓取（不需要登录的网站）

**目标**: 实现基础的 URL 文章抓取，支持公开访问的网站

#### P1.1: 实现基础 URL 抓取服务
**文件**: `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksURLFetcher.swift`

**任务**:
1. 实现 `GoodLinksURLFetcher` 类
   ```swift
   final class GoodLinksURLFetcher: GoodLinksURLFetcherProtocol {
       private let logger: LoggerServiceProtocol
       private let session: URLSession
       
       init(logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
            session: URLSession = .shared) {
           self.logger = logger
           self.session = session
       }
       
       func fetchArticle(url: String) async throws -> ArticleFetchResult {
           // 1. 验证 URL
           guard let url = URL(string: url) else {
               throw URLFetchError.invalidURL
           }
           
           // 2. 发起 HTTP 请求
           var request = URLRequest(url: url)
           request.setValue("Mozilla/5.0 ...", forHTTPHeaderField: "User-Agent")
           
           let (data, response) = try await session.data(for: request)
           
           // 3. 检查响应状态
           guard let httpResponse = response as? HTTPURLResponse else {
               throw URLFetchError.networkError(...)
           }
           
           guard httpResponse.statusCode == 200 else {
               if httpResponse.statusCode == 401 || httpResponse.statusCode == 403 {
                   throw URLFetchError.authenticationRequired
               }
               throw URLFetchError.networkError(...)
           }
           
           // 4. 解析 HTML（使用简单的正则或字符串处理）
           guard let html = String(data: data, encoding: .utf8) else {
               throw URLFetchError.parsingFailed
           }
           
           // 5. 提取元数据和内容（简单版本）
           let (title, author, content) = extractArticleContent(from: html)
           
           return ArticleFetchResult(
               title: title,
               content: content,
               textContent: stripHTML(content),
               author: author,
               publishedDate: nil,
               wordCount: countWords(stripHTML(content)),
               fetchedAt: Date(),
               source: .url
           )
       }
       
       // 简单的 HTML 内容提取（基于常见标签）
       private func extractArticleContent(from html: String) -> (String?, String?, String) {
           // 1. 提取 title
           let title = extractTag(html, tagName: "title")
               ?? extractMetaContent(html, property: "og:title")
           
           // 2. 提取 author
           let author = extractMetaContent(html, name: "author")
               ?? extractMetaContent(html, property: "article:author")
           
           // 3. 提取正文（尝试常见容器）
           let content = extractMainContent(html)
           
           return (title, author, content)
       }
   }
   ```

2. 添加辅助方法:
   - `extractTag(_:tagName:)`: 提取 HTML 标签内容
   - `extractMetaContent(_:name:)`: 提取 meta 标签内容
   - `extractMainContent(_:)`: 提取正文（查找 `<article>`, `<main>`, `.post-content` 等）
   - `stripHTML(_:)`: 去除 HTML 标签
   - `countWords(_:)`: 统计字数

**验证**:
- 测试常见网站（如 Medium、个人博客）
- 确保能正确提取标题、作者和正文
- 错误处理正确（网络错误、解析失败等）

#### P1.2: 集成到 GoodLinks 服务
**文件**: 
- `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksService.swift`
- `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksProtocols.swift`

**任务**:
1. 扩展 `GoodLinksDatabaseServiceProtocol`:
   ```swift
   protocol GoodLinksDatabaseServiceProtocol {
       // 现有方法...
       
       /// 获取文章内容（智能回退：数据库 -> URL）
       func fetchArticleContent(linkId: String, url: String) async throws -> ArticleFetchResult
   }
   ```

2. 在 `GoodLinksDatabaseService` 中实现:
   ```swift
   func fetchArticleContent(linkId: String, url: String) async throws -> ArticleFetchResult {
       // 1. 首先尝试从数据库获取
       if let dbContent = try? fetchContent(dbPath: resolveDatabasePath(), linkId: linkId),
          let content = dbContent.content, !content.isEmpty {
           logger.info("[GoodLinks] 使用数据库内容，linkId=\(linkId)")
           return ArticleFetchResult(
               title: nil,
               content: content,
               textContent: content,
               author: nil,
               publishedDate: nil,
               wordCount: dbContent.wordCount,
               fetchedAt: Date(),
               source: .database
           )
       }
       
       // 2. 数据库内容为空或失败，尝试 URL 抓取
       logger.info("[GoodLinks] 数据库无内容，尝试 URL 抓取，url=\(url)")
       let urlFetcher = GoodLinksURLFetcher()
       return try await urlFetcher.fetchArticle(url: url)
   }
   ```

**验证**:
- 测试回退逻辑：数据库有内容时优先使用
- 测试 URL 抓取：数据库无内容时自动抓取
- Build 成功

#### P1.3: 更新 ViewModel 和 UI
**文件**:
- `SyncNos/ViewModels/GoodLinks/GoodLinksDetailViewModel.swift`

**任务**:
1. 在 `GoodLinksDetailViewModel` 中添加新状态:
   ```swift
   enum ContentLoadState: Equatable {
       case notLoaded
       case preview(String, Int)
       case loadingFull
       case loaded
       case loadingFromURL         // 新增：正在从 URL 获取
       case error(String)
   }
   
   @Published var fetchSource: FetchSource? = nil  // 显示内容来源
   ```

2. 修改 `loadFullContent(for:)` 方法，支持 URL 抓取:
   ```swift
   private func loadFullContent(for linkId: String) async {
       contentLoadState = .loadingFull
       
       guard let link = /* 获取 link 信息 */ else { return }
       
       do {
           let result = try await serviceForTask.fetchArticleContent(
               linkId: linkId, 
               url: link.url
           )
           
           content = GoodLinksContentRow(
               id: linkId,
               content: result.textContent,
               wordCount: result.wordCount,
               videoDuration: nil
           )
           fetchSource = result.source
           contentLoadState = .loaded
           
           if result.source == .url {
               loggerForTask.info("[GoodLinksDetail] 从 URL 获取到内容，url=\(link.url)")
           }
       } catch {
           contentLoadState = .error(error.localizedDescription)
       }
   }
   ```

3. 在 UI 中显示内容来源标识（可选）:
   ```swift
   // 在 GoodLinksDetailView.swift 中添加来源徽章
   if let source = detailViewModel.fetchSource, source == .url {
       Label("Fetched from URL", systemImage: "globe")
           .font(.caption)
           .foregroundColor(.blue)
   }
   ```

**验证**:
- UI 正确显示内容来源
- 从 URL 抓取的内容正常展示
- Build 成功，UI 无报错

#### P1.4: 添加到 DIContainer
**文件**: `SyncNos/Services/Core/DIContainer.swift`

**任务**:
1. 添加 URL Fetcher 服务:
   ```swift
   private var _goodLinksURLFetcher: GoodLinksURLFetcherProtocol?
   
   var goodLinksURLFetcher: GoodLinksURLFetcherProtocol {
       if _goodLinksURLFetcher == nil {
           _goodLinksURLFetcher = GoodLinksURLFetcher()
       }
       return _goodLinksURLFetcher!
   }
   ```

**验证**:
- DIContainer 编译通过
- 服务可以正确注入

---

### P2: WebKit 登录支持（需要登录的网站）

**目标**: 实现 WebKit 登录功能，支持需要登录的网站（如 Medium 会员内容、付费博客等）

#### P2.1: 创建 GoodLinks 认证服务
**文件**: `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksAuthService.swift`（新建）

**任务**:
1. 参考 `WeReadAuthService.swift` 和 `DedaoAuthService.swift` 实现:
   ```swift
   protocol GoodLinksAuthServiceProtocol: Sendable {
       var isLoggedIn: Bool { get }
       func updateCookies(_ cookies: [HTTPCookie])
       func getCookieHeader(for url: String) -> String?
       func clearCookies()
   }
   
   final class GoodLinksAuthService: GoodLinksAuthServiceProtocol {
       private let logger: LoggerServiceProtocol
       private let keychainKey = "goodlinks_auth_cookies"
       
       // 使用 Keychain 存储 cookies（安全）
       var isLoggedIn: Bool {
           return getCookies().count > 0
       }
       
       func updateCookies(_ cookies: [HTTPCookie]) {
           // 序列化并保存到 Keychain
           let data = try? NSKeyedArchiver.archivedData(
               withRootObject: cookies, 
               requiringSecureCoding: false
           )
           KeychainHelper.save(data: data, forKey: keychainKey)
       }
       
       func getCookieHeader(for url: String) -> String? {
           let cookies = getCookies()
           guard let url = URL(string: url) else { return nil }
           
           // 筛选适用于该 URL 的 cookies
           let applicableCookies = cookies.filter { cookie in
               // 检查 domain 是否匹配
               if let domain = cookie.domain {
                   return url.host?.contains(domain) ?? false
               }
               return false
           }
           
           return applicableCookies.map { "\($0.name)=\($0.value)" }
               .joined(separator: "; ")
       }
       
       private func getCookies() -> [HTTPCookie] {
           guard let data = KeychainHelper.load(forKey: keychainKey),
                 let cookies = try? NSKeyedUnarchiver.unarchivedObject(
                     ofClasses: [NSArray.self, HTTPCookie.self],
                     from: data
                 ) as? [HTTPCookie] else {
               return []
           }
           return cookies
       }
   }
   ```

**验证**:
- 编译通过
- Keychain 存储/读取正常

#### P2.2: 创建 WebKit 登录视图
**文件**: 
- `SyncNos/Views/Settings/SyncFrom/GoodLinksLoginView.swift`（新建）
- `SyncNos/ViewModels/GoodLinks/GoodLinksLoginViewModel.swift`（新建）

**任务**:
1. 参考 `WeReadLoginView.swift` 实现 `GoodLinksLoginView`:
   ```swift
   private struct GoodLinksWebView: NSViewRepresentable {
       let webView: WKWebView
       
       func makeNSView(context: Context) -> WKWebView {
           webView
       }
       
       func updateNSView(_ nsView: WKWebView, context: Context) {}
   }
   
   struct GoodLinksLoginView: View {
       @Environment(\.dismiss) private var dismiss
       @StateObject private var viewModel: GoodLinksLoginViewModel
       @State private var webView = WKWebView()
       @State private var currentURL: String = ""
       
       let onLoginChanged: (() -> Void)?
       
       var body: some View {
           VStack {
               // URL 输入框（用户可以输入需要登录的网站）
               HStack {
                   TextField("Enter URL", text: $currentURL)
                       .textFieldStyle(.roundedBorder)
                   Button("Go") {
                       if let url = URL(string: currentURL) {
                           webView.load(URLRequest(url: url))
                       }
                   }
               }
               .padding()
               
               GoodLinksWebView(webView: webView)
           }
           .frame(minWidth: 640, minHeight: 600)
           .toolbar {
               ToolbarItem(placement: .confirmationAction) {
                   Button {
                       captureCookiesFromWebView()
                       dismiss()
                   } label: {
                       Label("Save Cookies", systemImage: "checkmark.circle")
                   }
               }
           }
       }
       
       private func captureCookiesFromWebView() {
           let store = webView.configuration.websiteDataStore.httpCookieStore
           store.getAllCookies { cookies in
               guard !cookies.isEmpty else {
                   Task { @MainActor in
                       viewModel.statusMessage = "No cookies found"
                   }
                   return
               }
               Task { @MainActor in
                   viewModel.saveCookies(cookies)
                   onLoginChanged?()
               }
           }
       }
   }
   ```

2. 实现 `GoodLinksLoginViewModel`:
   ```swift
   @MainActor
   final class GoodLinksLoginViewModel: ObservableObject {
       @Published var isLoggedIn: Bool = false
       @Published var statusMessage: String?
       
       private let authService: GoodLinksAuthServiceProtocol
       
       init(authService: GoodLinksAuthServiceProtocol = DIContainer.shared.goodLinksAuthService) {
           self.authService = authService
           refreshState()
       }
       
       func refreshState() {
           isLoggedIn = authService.isLoggedIn
           statusMessage = isLoggedIn ? "Logged in" : "Not logged in"
       }
       
       func saveCookies(_ cookies: [HTTPCookie]) {
           authService.updateCookies(cookies)
           refreshState()
       }
   }
   ```

**验证**:
- WebView 可以正常加载网页
- 登录后可以捕获 cookies
- Cookies 保存到 Keychain

#### P2.3: 集成认证到 URL Fetcher
**文件**: `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksURLFetcher.swift`

**任务**:
1. 添加带认证的抓取方法:
   ```swift
   final class GoodLinksURLFetcher: GoodLinksURLFetcherProtocol {
       private let authService: GoodLinksAuthServiceProtocol
       
       init(logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
            authService: GoodLinksAuthServiceProtocol = DIContainer.shared.goodLinksAuthService,
            session: URLSession = .shared) {
           self.logger = logger
           self.authService = authService
           self.session = session
       }
       
       func fetchArticle(url: String) async throws -> ArticleFetchResult {
           // 如果有登录，自动使用认证
           if authService.isLoggedIn, 
              let cookieHeader = authService.getCookieHeader(for: url) {
               return try await fetchArticleWithAuth(url: url, cookieHeader: cookieHeader)
           }
           
           // 否则使用无认证模式（现有逻辑）
           return try await fetchArticleWithoutAuth(url: url)
       }
       
       private func fetchArticleWithAuth(url: String, cookieHeader: String) async throws -> ArticleFetchResult {
           guard let url = URL(string: url) else {
               throw URLFetchError.invalidURL
           }
           
           var request = URLRequest(url: url)
           request.setValue("Mozilla/5.0 ...", forHTTPHeaderField: "User-Agent")
           request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
           
           let (data, response) = try await session.data(for: request)
           
           // ... 其余逻辑与 fetchArticleWithoutAuth 相同
           
           return ArticleFetchResult(
               // ...
               source: .urlWithAuth
           )
       }
   }
   ```

**验证**:
- 带 Cookie 的请求能成功获取需要登录的内容
- 无登录时自动降级为普通模式

#### P2.4: 添加登录入口到设置界面
**文件**: `SyncNos/Views/Settings/SyncFrom/GoodLinksSettingsView.swift`

**任务**:
1. 添加 "Login for Protected Content" 按钮:
   ```swift
   struct GoodLinksSettingsView: View {
       @StateObject private var loginViewModel = GoodLinksLoginViewModel()
       @State private var showingLoginSheet = false
       
       var body: some View {
           Form {
               // 现有设置...
               
               Section("Authentication") {
                   HStack {
                       if loginViewModel.isLoggedIn {
                           Label("Logged in", systemImage: "checkmark.circle.fill")
                               .foregroundColor(.green)
                           
                           Button("Clear Cookies") {
                               DIContainer.shared.goodLinksAuthService.clearCookies()
                               loginViewModel.refreshState()
                           }
                       } else {
                           Label("Not logged in", systemImage: "xmark.circle")
                               .foregroundColor(.secondary)
                           
                           Button("Login for Protected Content") {
                               showingLoginSheet = true
                           }
                       }
                   }
               }
           }
           .sheet(isPresented: $showingLoginSheet) {
               GoodLinksLoginView(
                   viewModel: loginViewModel,
                   onLoginChanged: {
                       loginViewModel.refreshState()
                   }
               )
           }
       }
   }
   ```

**验证**:
- 设置界面显示正常
- 点击登录按钮弹出 WebView
- 登录后状态更新

#### P2.5: 更新 DIContainer
**文件**: `SyncNos/Services/Core/DIContainer.swift`

**任务**:
1. 添加认证服务:
   ```swift
   private var _goodLinksAuthService: GoodLinksAuthServiceProtocol?
   
   var goodLinksAuthService: GoodLinksAuthServiceProtocol {
       if _goodLinksAuthService == nil {
           _goodLinksAuthService = GoodLinksAuthService()
       }
       return _goodLinksAuthService!
   }
   ```

**验证**:
- DIContainer 编译通过
- 依赖注入正常工作

---

### P3: 高级功能与优化

**目标**: 提升用户体验，添加缓存、错误处理、UI 优化等

#### P3.1: 添加 URL 抓取缓存
**文件**: `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksURLCache.swift`（新建）

**任务**:
1. 实现本地缓存机制（使用 UserDefaults 或 SwiftData）:
   ```swift
   final class GoodLinksURLCache {
       private let cacheKey = "goodlinks_url_cache"
       private let cacheExpiration: TimeInterval = 3600 * 24 * 7 // 7 天
       
       struct CachedArticle: Codable {
           let url: String
           let result: ArticleFetchResult
           let cachedAt: Date
           
           var isExpired: Bool {
               Date().timeIntervalSince(cachedAt) > 3600 * 24 * 7
           }
       }
       
       func get(url: String) -> ArticleFetchResult? {
           guard let cache = loadCache(),
                 let cached = cache[url],
                 !cached.isExpired else {
               return nil
           }
           return cached.result
       }
       
       func set(url: String, result: ArticleFetchResult) {
           var cache = loadCache() ?? [:]
           cache[url] = CachedArticle(
               url: url,
               result: result,
               cachedAt: Date()
           )
           saveCache(cache)
       }
       
       private func loadCache() -> [String: CachedArticle]? {
           // 从 UserDefaults 或 SwiftData 加载
       }
       
       private func saveCache(_ cache: [String: CachedArticle]) {
           // 保存到 UserDefaults 或 SwiftData
       }
   }
   ```

2. 集成到 `GoodLinksURLFetcher`:
   ```swift
   func fetchArticle(url: String) async throws -> ArticleFetchResult {
       // 1. 检查缓存
       if let cached = cache.get(url: url) {
           logger.info("[URLFetcher] 使用缓存内容，url=\(url)")
           return cached
       }
       
       // 2. 抓取新内容
       let result = try await fetchArticleWithoutAuth(url: url)
       
       // 3. 更新缓存
       cache.set(url: url, result: result)
       
       return result
   }
   ```

**验证**:
- 缓存读写正常
- 缓存过期后自动重新抓取

#### P3.2: 添加重试机制和错误提示
**文件**: `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksURLFetcher.swift`

**任务**:
1. 添加重试逻辑（参考 `WeReadRequestLimiter.swift`）:
   ```swift
   private func fetchWithRetry(url: String, maxRetries: Int = 3) async throws -> ArticleFetchResult {
       var lastError: Error?
       
       for attempt in 1...maxRetries {
           do {
               return try await fetchArticle(url: url)
           } catch {
               lastError = error
               logger.warning("[URLFetcher] 抓取失败，重试 \(attempt)/\(maxRetries)，error=\(error)")
               
               // 等待后重试（指数退避）
               try await Task.sleep(nanoseconds: UInt64(pow(2.0, Double(attempt)) * 1_000_000_000))
           }
       }
       
       throw lastError ?? URLFetchError.networkError(...)
   }
   ```

2. 在 UI 中显示友好的错误提示:
   ```swift
   // 在 GoodLinksDetailView.swift 中
   if case .error(let message) = detailViewModel.contentLoadState {
       VStack(spacing: 12) {
           Image(systemName: "exclamationmark.triangle")
               .font(.largeTitle)
               .foregroundColor(.orange)
           
           Text("Failed to load article content")
               .font(.headline)
           
           Text(message)
               .font(.caption)
               .foregroundColor(.secondary)
           
           HStack {
               Button("Retry") {
                   Task {
                       await detailViewModel.loadContentOnDemand()
                   }
               }
               
               Button("Copy URL") {
                   NSPasteboard.general.clearContents()
                   NSPasteboard.general.setString(link.url, forType: .string)
               }
           }
       }
       .padding()
   }
   ```

**验证**:
- 重试机制工作正常
- 错误提示友好且可操作

#### P3.3: 添加 URL 抓取配置选项
**文件**: `SyncNos/Views/Settings/SyncFrom/GoodLinksSettingsView.swift`

**任务**:
1. 添加配置选项:
   ```swift
   Section("Content Fetching") {
       Toggle("Enable URL Fetching", isOn: $viewModel.urlFetchingEnabled)
           .help("Fetch article content from URL when database content is unavailable")
       
       Toggle("Prefer Database Content", isOn: $viewModel.preferDatabaseContent)
           .help("Always try to use database content first, even if URL fetching is available")
       
       Picker("Fetch Strategy", selection: $viewModel.fetchStrategy) {
           Text("Database Only").tag(FetchStrategy.databaseOnly)
           Text("URL Only").tag(FetchStrategy.urlOnly)
           Text("Database → URL (Fallback)").tag(FetchStrategy.fallback)
       }
   }
   ```

2. 保存配置到 UserDefaults

**验证**:
- 配置选项正常保存和加载
- 不同策略正确执行

#### P3.4: 性能优化与日志
**任务**:
1. 添加性能监控:
   ```swift
   func fetchArticle(url: String) async throws -> ArticleFetchResult {
       let startTime = Date()
       defer {
           let duration = Date().timeIntervalSince(startTime)
           logger.info("[URLFetcher] 抓取耗时 \(duration)s，url=\(url)")
       }
       
       // 抓取逻辑...
   }
   ```

2. 完善日志记录:
   - 记录每次抓取的来源（数据库 vs URL）
   - 记录失败原因和重试次数
   - 记录缓存命中率

**验证**:
- 日志输出完整且清晰
- 性能指标准确

---

### P4: 国际化与文档

**目标**: 添加多语言支持和完善文档

#### P4.1: 添加本地化字符串
**文件**: `Resource/Localizable.xcstrings`

**任务**:
1. 添加新的本地化字符串:
   - "Fetched from URL"
   - "Enable URL Fetching"
   - "Login for Protected Content"
   - "Failed to load article content"
   - "URL fetching is disabled"
   - 等等...

2. 至少提供英文和中文翻译

**验证**:
- 切换语言后 UI 文本正确显示

#### P4.2: 更新 CLAUDE.md 文档
**文件**: `CLAUDE.md`

**任务**:
1. 更新架构说明，添加 GoodLinks URL 抓取服务
2. 更新核心功能列表
3. 添加 URL 抓取服务说明
4. 更新依赖注入部分

**验证**:
- 文档清晰且准确

#### P4.3: 添加用户使用说明
**文件**: 在 `GoodLinksSettingsView` 中添加帮助文本

**任务**:
1. 添加使用说明:
   ```swift
   Section {
       VStack(alignment: .leading, spacing: 8) {
           Text("URL Fetching")
               .font(.headline)
           
           Text("""
           When GoodLinks database doesn't contain article content, \
           SyncNos can fetch it directly from the URL. \
           For protected content, you need to log in first.
           """)
           .font(.caption)
           .foregroundColor(.secondary)
       }
   } header: {
       Text("About URL Fetching")
   }
   ```

**验证**:
- 帮助文本清晰易懂

---

## 验证清单（每个优先级完成后）

### P0 验证
- [ ] 协议和模型定义完整
- [ ] 编译通过
- [ ] 架构清晰，符合 MVVM

### P1 验证
- [ ] 可以从 URL 抓取文章内容（测试 3-5 个不同网站）
- [ ] 回退逻辑正常（数据库 → URL）
- [ ] UI 正确显示内容来源
- [ ] Build 成功，无运行时错误
- [ ] 日志完整

### P2 验证
- [ ] WebView 登录功能正常
- [ ] Cookies 正确保存和加载
- [ ] 带认证的请求能获取受保护内容
- [ ] 设置界面显示登录状态
- [ ] Build 成功

### P3 验证
- [ ] 缓存机制工作正常
- [ ] 重试逻辑正确
- [ ] 错误提示友好
- [ ] 配置选项生效
- [ ] 性能指标准确

### P4 验证
- [ ] 本地化字符串完整
- [ ] 文档更新准确
- [ ] 用户帮助清晰

---

## 依赖关系图

```
P0 (架构设计)
  ↓
P1 (基础 URL 抓取)
  ├─ P1.1 → P1.2 → P1.3 → P1.4
  ↓
P2 (WebKit 登录)
  ├─ P2.1 → P2.2 → P2.3 → P2.4 → P2.5
  ↓
P3 (优化)
  ├─ P3.1, P3.2, P3.3, P3.4 (可并行)
  ↓
P4 (国际化与文档)
  ├─ P4.1, P4.2, P4.3 (可并行)
```

---

## 技术风险与缓解措施

### 风险 1: HTML 解析困难
**描述**: 不同网站的 HTML 结构差异大，简单的字符串处理可能无法提取正文

**缓解措施**:
1. **P1 阶段**: 使用简单的标签匹配（`<article>`, `<main>` 等），支持常见网站
2. **P3 阶段**: 考虑引入 SwiftSoup 或 Kanna 等 HTML 解析库（如有必要）
3. 提供配置选项让用户选择抓取策略（保守 vs 激进）

### 风险 2: 需要 JavaScript 渲染的网站
**描述**: 部分网站（如单页应用）需要执行 JavaScript 才能显示内容

**缓解措施**:
1. **P1 阶段**: 明确不支持，返回友好错误提示
2. **P2 阶段**: 使用 WebKit 的 `evaluateJavaScript` 功能，在登录视图中等待页面加载完成后再提取内容
3. 提供"在浏览器中打开"按钮作为备选方案

### 风险 3: 网站反爬限制
**描述**: 部分网站可能有反爬虫机制（User-Agent 检测、IP 限制等）

**缓解措施**:
1. 使用真实的 User-Agent（模拟浏览器）
2. 添加请求间隔和重试机制（参考 `WeReadRequestLimiter`）
3. 对于严格的网站，提示用户通过 WebView 登录

### 风险 4: Cookie 过期
**描述**: 保存的 Cookies 可能过期，导致认证失败

**缓解措施**:
1. 检测 401/403 错误，提示用户重新登录
2. 在设置界面显示登录状态和过期提示
3. 实现自动刷新机制（如果网站支持）

---

## 性能指标

- **URL 抓取响应时间**: < 5 秒（95% 情况）
- **缓存命中率**: > 70%（重复访问）
- **内存占用**: 增加 < 50MB（缓存 + 网络请求）
- **错误率**: < 5%（常见网站）

---

## 后续扩展方向（可选）

1. **Reader Mode 提取**: 集成类似 Safari Reader Mode 的正文提取算法
2. **批量抓取**: 支持批量刷新所有文章内容
3. **离线阅读**: 下载文章内容到本地，支持离线查看
4. **自定义提取规则**: 允许用户为特定网站配置 CSS Selector
5. **RSS 支持**: 对于有 RSS 的网站，优先使用 RSS 提取内容

---

## 总结

本方案分为 4 个主要优先级（P0-P4），每个优先级包含多个子任务。实现顺序为：
1. **P0**: 架构设计（1-2 小时）
2. **P1**: 基础 URL 抓取（4-6 小时）
3. **P2**: WebKit 登录（3-4 小时）
4. **P3**: 优化（2-3 小时）
5. **P4**: 国际化与文档（1-2 小时）

**总预计时间**: 11-17 小时

每完成一个优先级，都需要验证代码无问题并能成功 build，确保项目始终处于可运行状态。
