# GoodLinks URL 文章获取功能实现方案（Plan A / URL Only）

## 背景

SyncNos 的 GoodLinks 数据来自 GoodLinks app 的 SQLite 数据库（links/highlights 等结构化信息），但**文章正文**不稳定（历史上来自 `content` 表），存在：
1. `content` 可能为空或不完整
2. 内容格式不一致（HTML/Markdown/处理过的文本）
3. 依赖 GoodLinks 先抓取并写入本地内容，导致正文滞后或缺失

**解决方案（URL Only）**：完全放弃数据库正文读取，改为**直接从 URL 抓取文章内容**：
- 公开网页：直接 HTTP GET + 轻量正文提取（优先 `<article>` / `<main>`）
- 受保护网页：后续扩展 WebKit 登录拿 Cookie，再带 Cookie 抓取
- 全项目统一通过 `GoodLinksURLFetcher` 获取正文（不再存在数据库正文 fallback）

---

## 当前实现状态（已完成）

> 代码已落地且通过编译：`xcodebuild -scheme SyncNos build -quiet`

- ✅ 已新增 `GoodLinksURLFetcher` 与协议：`SyncNos/Services/DataSources-From/GoodLinks/GoodLinksURLFetcher.swift`
- ✅ 已新增 URL 抓取模型与错误类型：`SyncNos/Services/DataSources-From/GoodLinks/GoodLinksModels.swift`
  - `ArticleFetchResult` / `FetchSource` / `URLFetchError`
- ✅ 已在 DIContainer 注册：`SyncNos/Services/Core/DIContainer.swift`（`goodLinksURLFetcher`）
- ✅ 已将 GoodLinks 详情页正文加载改为 URL Only：
  - `SyncNos/ViewModels/GoodLinks/GoodLinksDetailViewModel.swift`（`article: ArticleFetchResult?`）
  - `SyncNos/Views/GoodLinks/GoodLinksDetailView.swift`（向 VM 传入 `GoodLinksLinkRow`）
- ✅ 已将 Notion 同步的 “Article” 正文改为 URL Only：
  - `SyncNos/Services/DataSources-To/Notion/SyncEngine/Adapters/GoodLinksNotionAdapter.swift`
  - `GoodLinksNotionAdapter.create(...)` 已改为 `async`
- ✅ 已彻底删除 SQLite `content` 表相关代码（协议/查询/模型/调用链）
  - 不再存在 `GoodLinksContentRow`、`fetchContent`、`fetchContentPreview`、SQL `FROM content`

---

## 优先级分级与后续计划（从当前实现继续）

### P0: 架构设计与基础模型（准备阶段）✅

**目标**: 定义清晰的架构和数据模型，为后续 URL 抓取主路径打下基础

#### P0.1: 定义服务协议和数据模型
**文件**:
- `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksURLFetcher.swift`
- `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksModels.swift`

**状态**: ✅ 已完成

**实现要点（现状）**:
- `GoodLinksURLFetcherProtocol`
  - `fetchArticle(url: String) async throws -> ArticleFetchResult`
  - `fetchArticleWithAuth(url: String, cookies: [HTTPCookie]) async throws -> ArticleFetchResult`
- `ArticleFetchResult`
  - `content` 当前为 HTML 片段（抓取后提取 `<article>` / `<main>` / `<body>` 的片段包装）
  - `textContent` 为纯文本（用于搜索/Notion 同步）
- `URLFetchError` 已覆盖：URL 校验、HTTP 状态、认证需求、限流、解析/内容缺失等

**验证**: 
- ✅ 编译通过
- ✅ 类型均为 `Sendable`（便于 async 任务传递）

---

### P1: 基础 URL 抓取（不需要登录的网站）✅

**目标**: 实现基础的 URL 文章抓取，支持公开访问的网站

#### P1.1: 实现基础 URL 抓取服务
**文件**: `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksURLFetcher.swift`

**状态**: ✅ 已完成（当前实现为“轻量正文提取”，非 Reader Mode）

**实现要点（现状）**:
- URL 校验：仅允许 `http/https`
- HTTP：自定义 `User-Agent` + `Accept`
- 状态码：
  - `401/403` → `.authenticationRequired`
  - `429` → `.rateLimited`
  - 其它非 200 → `.httpStatus(code)`
- HTML 提取策略：
  - 移除 `<script>`/`<style>` 降噪
  - 优先取 `<article>`，其次 `<main>`，再退到 `<body>`
- 纯文本提取：`NSAttributedString` HTML 转换（失败则 fallback 正则去标签）
- 统计字数：按 `byWords` 枚举

**验证**:
- ✅ 编译通过
- ⏳（建议）运行时抽样验证：Medium/个人博客/少数派/公众号外链等

#### P1.2: 集成策略（当前实现）
**状态**: ✅ 已改为直接注入 URLFetcher（不扩展数据库服务协议）

**说明**:
- 目前 “正文抓取” 不属于 SQLite service 责任范围，直接通过 `DIContainer.shared.goodLinksURLFetcher` 使用
- SQLite 仅保留 links/highlights 的读取能力（正文完全不再走 DB）

#### P1.3: 更新 ViewModel 和 UI
**文件**:
- `SyncNos/ViewModels/GoodLinks/GoodLinksDetailViewModel.swift`
- `SyncNos/Views/GoodLinks/GoodLinksDetailView.swift`

**状态**: ✅ 已完成（并保持原有“按需加载/卸载全文”交互）

**实现要点（现状）**:
- VM 不再持有 `GoodLinksContentRow`，改为 `article: ArticleFetchResult?`
- 预览与全文均通过 URLFetcher 获取；折叠时卸载以释放内存
- `GoodLinksDetailView` 在 `.task(id: linkId)` 与展开/重试时传入 `GoodLinksLinkRow`（避免 VM 自己反查 link 列表）

**验证**:
- ✅ Build 成功
- ⏳（建议）手动验证：展开/折叠/切换 link/刷新时正文状态不串台

#### P1.4: 添加到 DIContainer
**文件**: `SyncNos/Services/Core/DIContainer.swift`

**状态**: ✅ 已完成

**验证**:
- ✅ DIContainer 编译通过

---

### P2: WebKit 登录支持（需要登录的网站）✅

**目标**: 实现 WebKit 登录功能，支持需要登录的网站（如 Medium 会员内容、付费博客等）

**状态**: ✅ 已完成（已支持多站点登录：WebView 获取 cookies → Keychain 持久化 → 请求自动带 Cookie）

#### P2.1: 创建 GoodLinks 认证服务
**文件**: `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksAuthService.swift`（新建）

**状态**: ✅ 已完成（多站点 cookies 合并存储，按 URL 生成 Cookie Header）

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

**状态**: ✅ 已完成

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

**状态**: ✅ 已完成（`fetchArticle(url:)` 自动使用已保存 cookies）

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
**文件**:
- `SyncNos/Views/Settings/General/SettingsView.swift`
- `SyncNos/Views/Settings/General/SiteLoginsView.swift`

**状态**: ✅ 已完成（登录管理已拆分到 Settings 侧边栏的 `Site Logins`，不再放在 GoodLinks 设置页）

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

**状态**: ✅ 已完成（`goodLinksAuthService` 已注入到 `goodLinksURLFetcher`）

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

#### P3.1: 添加 URL 抓取缓存✅
**文件**:
- `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksURLCacheModels.swift`（新建）
- `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksURLCacheService.swift`（新建）
- `SyncNos/Services/Core/DIContainer.swift`（注入）
- `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksURLFetcher.swift`（读写缓存）

**状态**: ✅ 已完成（SwiftData 持久化缓存，TTL=7 天）

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

**状态**: ⏳ 部分完成
- ✅ UI 侧已有错误提示与 Retry 按钮（`ArticleContentCardView`）
- ⏳ Fetcher 的指数退避重试逻辑尚未实现

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

**状态**: ⏳ 未开始（目前为 URL Only 固定策略）

**任务**:
1. 添加配置选项:
   ```swift
   Section("Content Fetching") {
       Toggle("Enable URL Fetching", isOn: $viewModel.urlFetchingEnabled)
           .help("Fetch article content directly from the URL")
       
       Picker("Fetch Strategy", selection: $viewModel.fetchStrategy) {
           Text("URL Only").tag(FetchStrategy.urlOnly)
           Text("URL (Use Login if Available)").tag(FetchStrategy.urlWithAuthFirst)
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
   - 记录每次抓取的来源（URL vs URL-Auth）
   - 记录失败原因和重试次数
   - 记录缓存命中率

**状态**: ⏳ 部分完成（Fetcher 已记录单次请求耗时；缓存命中率/重试次数统计尚未补齐）

**验证**:
- ✅ Build 通过
- ⏳（建议）补齐：缓存命中率/重试次数/失败原因聚合日志

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

每完成一个优先级，都需要验证代码无问题并能成功 build，确保项目始终处于可运行状态。
