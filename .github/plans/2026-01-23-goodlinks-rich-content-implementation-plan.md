# GoodLinks 富内容（图片 + 样式）实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收（每批次完成后跑一次 `xcodebuild -scheme SyncNos build`）。

**Goal（目标）**
- Notion 同步：把 GoodLinks 抓取到的文章 HTML 转为 Notion blocks，**按原文顺序**保留结构并支持图片（先用原图 URL：`image.external`）。
- App 展示：详情页文章内容从“纯文本”升级为“富文本渲染”（可显示图片、标题/段落/列表/引用/链接等基本样式）。
- 持久化：URL 抓取结果写入本地缓存（SwiftData），避免每次打开都重新 fetch。✅

**Non-goals（非目标）**
- 不做：复杂交互/脚本执行、评论区、站点嵌入（iframe/video）、表格/数学公式的完整还原。
- 不做：受保护图片的稳定展示（防盗链/临时签名失效）——后续再做“转存为 Notion 文件”的增强。
- 不做：全文“完美排版一致”，以可读性为主（CSS 统一风格）。

**Approach（方案 / 推荐 Plan A）**
- **Notion 侧**：用 `WKWebView` 作为 HTML 解析器（WebKit 对不规范 HTML 容错强、无需引入第三方库），在隐藏 WebView 中 `loadHTMLString`，通过 JavaScript 将 DOM 按顺序提取为一个轻量 JSON（段落/标题/列表/引用/分隔线/图片），再映射成 Notion blocks 字典。
- **App 侧**：用 `WKWebView` 渲染 `ArticleFetchResult.content`（加一层统一 CSS），并设置 `baseURL` 解决相对链接/相对图片。

**Acceptance（验收）**
- 缓存：同一篇链接首次打开会 fetch，关闭后再次打开能命中缓存（无网络也能展示上次缓存内容）；缓存超过 TTL 会自动重新 fetch。✅
- Notion：同步 3 篇包含多张图片的文章，Notion 页面中图片作为 `image` block 出现，顺序与原文一致（图片不集中堆在顶部/底部）。
- App：GoodLinks 详情页展开文章后能看到图片；先保证“能显示图片 + 可读”，再逐步增强样式。
- 兼容：抓取不到正文时仍按当前逻辑显示 empty/error，不影响高亮同步。

---

## Plan A（主方案）：WebKit DOM → Notion blocks + WebKit 渲染

### P0：URL 抓取结果持久化缓存（SwiftData）✅

> 这是 Notion 与 App 展示的共同前置：如果没有缓存，用户会感知到“每次都重新抓网页”。

#### Task 0.1: 新增 SwiftData 缓存模型与服务（GoodLinksURLCacheService）✅

**Files**
- Create: `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksURLCacheModels.swift`
- Create: `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksURLCacheService.swift`

**Step**
- 参照 `WeReadCacheService.swift` / `DedaoCacheService.swift` 的模式：
  - `GoodLinksModelContainerFactory.createContainer()` 使用独立 store 文件（例如 `goodlinks_url_cache.store`）
  - `@Model`：`CachedGoodLinksArticle` 存储字段建议包含：
    - `url`（唯一键）
    - `title` / `author`（可选）
    - `contentHTML`（用于 App 富内容渲染与 Notion blocks 转换）
    - `textContent` / `wordCount`
    - `fetchedAt` / `cachedAt`
- TTL：默认 7 天；过期后自动当作未命中。

**Verify**
- Build: `xcodebuild -scheme SyncNos build`

---

#### Task 0.2: 在 DIContainer 注册缓存服务✅

**Files**
- Modify: `SyncNos/Services/Core/DIContainer.swift`

**Step**
- 新增 `goodLinksURLCacheService`，创建 ModelContainer 并初始化 `GoodLinksURLCacheService(modelContainer:)`。

**Verify**
- Build: `xcodebuild -scheme SyncNos build`

---

#### Task 0.3: URLFetcher 集成缓存（读写 + 日志）✅

**Files**
- Modify: `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksURLFetcher.swift`

**Step**
- `fetchArticle(...)` / `fetchArticleWithAuth(...)`：
  - 网络请求前：先查缓存（命中直接返回）
  - 网络成功后：写入缓存
  - 失败时：不要污染缓存

**Verify**
- Build: `xcodebuild -scheme SyncNos build`
- Manual：同一链接连续打开两次，第二次明显更快且日志提示命中缓存

---

### P1：为 Notion 新增“HTML → blocks（含图片）”转换器

#### Task 1: 新建转换器协议与实现（WebKit DOM 提取）

**Files**
- Create: `SyncNos/Services/DataSources-To/Notion/Core/NotionHTMLToBlocksConverter.swift`

**Step 1: 定义协议与输出约束**
- 定义协议（示例）：
  ```swift
  protocol NotionHTMLToBlocksConverterProtocol: Sendable {
      func convertArticleHTMLToBlocks(
          html: String,
          baseURL: URL
      ) async throws -> [[String: Any]]
  }
  ```
- 输出约束：
  - 每个 block 字典都包含 `"object": "block"`
  - 图片使用 `image: { "type": "external", "external": { "url": ... } }`
  - 文本内容需按 `NotionSyncConfig.maxTextLengthPrimary` 做 chunk（沿用/复用 `NotionHelperMethods` 的 chunk 逻辑）

**Step 2: 用隐藏 `WKWebView` 加载并提取 DOM JSON**
- 参考仓库现有 WebKit 使用方式：
  - `SyncNos/Views/Settings/SyncFrom/WeReadLoginView.swift`
  - `SyncNos/Views/Settings/SyncFrom/DedaoLoginView.swift`
  - `SyncNos/Services/DataSources-From/WeRead/WeReadCookieRefreshService.swift`
- `WKWebView` 使用 `loadHTMLString(html, baseURL: baseURL)`（不需要真的下载图片，只要拿到 `<img src>` 顺序即可）。
- JavaScript 输出建议为数组：
  - `[{type:"h2", text:"..."}, {type:"p", text:"..."}, {type:"img", src:"https://..."}, {type:"ul_li", text:"..."}, ...]`
  - 图片 URL 用 `new URL(img.getAttribute("src"), document.baseURI).href` 归一为绝对 URL。

**Step 3: 映射到 Notion blocks**
- 先做 block 级别结构（MVP）：
  - `h1/h2/h3` → `heading_1/2/3`
  - `p` → `paragraph`
  - `blockquote` → `quote`
  - `ul_li` → `bulleted_list_item`
  - `ol_li` → `numbered_list_item`
  - `hr` → `divider`
  - `img` → `image.external`
- 说明：Notion 的“文字”不是一个 HTML 字符串，而是 `rich_text` 数组。最简版本我们可以先用单段纯文本：
  - `rich_text: [["text": ["content": "一段文字"]]]`
- 本阶段先不做 inline 标注（bold/italic/link/code）也可以验收“图片 + 顺序 + 基本结构”；后续再增强（见 P2.5）。

**Verify**
- Build: `xcodebuild -scheme SyncNos build`

---

#### Task 2: 在 DIContainer 注册转换器（可注入、可替换）

**Files**
- Modify: `SyncNos/Services/Core/DIContainer.swift`

**Step**
- 添加 `notionHTMLToBlocksConverter` 的实例化与注入点（遵循现有 DI 风格）。

**Verify**
- Build: `xcodebuild -scheme SyncNos build`

---

### P2：GoodLinks Notion 同步改为 blocks（含图片）而不是纯文本 paragraph

#### Task 3: 扩展 GoodLinksNotionAdapter 预加载 HTML blocks

**Files**
- Modify: `SyncNos/Services/DataSources-To/Notion/SyncEngine/Adapters/GoodLinksNotionAdapter.swift`

**Step 1: 调整状态字段**
- 将 `articleText: String?` 替换为 `articleBlocks: [[String: Any]]?`（或两者并存，先平滑迁移）。

**Step 2: headerContentForNewPage() 输出 blocks**
- 仍保留 `"Article"` heading（现有逻辑）。
- `articleBlocks` 非空时：直接 append 到 children。
- `articleBlocks` 为空时：保持当前行为（不输出正文块）。

**Step 3: create(...) 中预加载**
- `urlFetcher.fetchArticle(url:)` 成功后：
  - 用 converter 将 `result.content`（HTML）+ `baseURL: URL(string: link.url)!` 转为 blocks
  - 将 blocks 注入 adapter
- 对 `contentNotFound` 等错误：降级为无正文（保持可同步高亮）。

**Verify**
- Build: `xcodebuild -scheme SyncNos build`

---

#### Task 4: Notion blocks 的长度与分块策略（避免 Notion API 限制）

**Files**
- Modify: `SyncNos/Services/DataSources-To/Notion/Core/NotionHelperMethods.swift`
- Or Modify: `SyncNos/Services/DataSources-To/Notion/Core/NotionHTMLToBlocksConverter.swift`

**Step**
- 复用已有 `buildParagraphBlocks(from:chunkSize:)` 的 chunk 思路：
  - 对每个 `p/quote/list_item/heading` 的文本按 chunkSize 切分成多个同类型 block（必要时）。

**Verify**
- Build: `xcodebuild -scheme SyncNos build`

---

### P2.5（可选增强）：Notion rich_text 的 inline 标注（bold/italic/link/code）

> 用于让 Notion 页面的文字更接近原网页，但不是“图片可见”的前置条件，可在 P1/P2 跑通后再做。

#### Task 5: JS 输出从 “text” 升级为 “segments”

**Files**
- Modify: `SyncNos/Services/DataSources-To/Notion/Core/NotionHTMLToBlocksConverter.swift`

**Step 1: 定义 segments 数据结构（概念）**
- 让 JS 输出每个文本块的富文本片段数组（示例）：
  ```json
  [
    { "text": "Hello ", "marks": {} },
    { "text": "world", "marks": { "bold": true } },
    { "text": " link", "marks": { "href": "https://example.com" } }
  ]
  ```
- Swift 侧把它映射为 Notion `rich_text`：
  - `marks.bold` → `annotations.bold = true`
  - `marks.italic` → `annotations.italic = true`
  - `marks.code` → `annotations.code = true`
  - `marks.href` → `text.link = ["url": "..."]`

**Step 2: 逐类支持（小步）**
- 先支持：`<a>`、`<strong>/<b>`、`<em>/<i>`、`<code>`。
- 不建议一开始就做复杂嵌套（例如 `<a><strong>...</strong></a>`），先用“就近标注”策略保证稳定。

**Verify**
- Build: `xcodebuild -scheme SyncNos build`

---

### P3：App 内文章展示从纯文本升级为 HTML 渲染（含图片与样式）

#### P3.1（先做）：图片渲染（HTML WebView 基础能力）

#### Task 6: 新增通用 HTML WebView 组件（SwiftUI）

**Files**
- Create: `SyncNos/Views/Components/Web/HTMLWebView.swift`
- Modify: `SyncNos/Views/Components/Cards/ArticleContentCardView.swift`

**Step 1: HTMLWebView**
- `NSViewRepresentable` 包装 `WKWebView`，支持：
  - `loadHTMLString(styledHTML, baseURL:)`
  - 可选：导航策略（点击链接时用外部浏览器打开）
- 先注入“最小 CSS”（只为图片与基础排版兜底）：
  - `img { max-width: 100%; height: auto; }`
  - `body { margin: 0; padding: 0; }`

**Step 2: ArticleContentCardView 改为渲染 HTML**
- 当前 `.loaded/.preview` 都是 `Text(content)`（纯文本），改为：
  - 展开后：显示 `HTMLWebView(html: ..., baseURL: ...)`
  - 折叠预览：先保持纯文本（性能更稳，避免 WebView 频繁创建/销毁）

**Verify**
- Build: `xcodebuild -scheme SyncNos build`
- Manual:
  - 打开任意含图片的 GoodLinks 链接详情页 → 展开 Article → 可看到图片

---

#### P3.2（再做）：文本样式美化（统一 CSS）

#### Task 7: 增强 CSS 与可读性（不改内容结构）

**Files**
- Modify: `SyncNos/Views/Components/Web/HTMLWebView.swift`

**Step**
- 在不影响图片显示的前提下，逐步增强排版（示例方向）：
  - `body { font: -apple-system-body; line-height: 1.6; color: ... }`
  - `h1,h2,h3 { ... }`
  - `p, li { ... }`
  - `blockquote { ... }`
  - `a { ... }`
  - `pre, code { font-family: ui-monospace; }`

**Verify**
- Build: `xcodebuild -scheme SyncNos build`
- Manual: 同一篇文章前后对比，正文更易读、层级更清晰

---

## P4（后续增强）：转存为 Notion 文件 URL（更稳定）

> 先完成 Plan A 的“原图 URL（image.external）”版本；此阶段再做稳定性增强。

### Task 6: 图片导入/转存开关（分域名/失败重试）

**Files（预期）**
- Modify: `SyncNos/Services/DataSources-To/Notion/Core/NotionService.swift`
- Modify: `SyncNos/Services/DataSources-To/Notion/Core/NotionRequestHelper.swift`
- Modify: `SyncNos/Services/DataSources-To/Notion/Core/NotionHTMLToBlocksConverter.swift`

**Step（设计要点）**
- 当命中以下条件时触发“转存”：
  - 站点防盗链（常见 403/401）或 URL 含短期签名（可配置规则）
  - Notion 页面内图片加载失败（无法从 API 直接得知时，可做“同步后抽样校验”作为辅助）
- 转存路径参考 Notion API “Importing external files”（后续实现时再展开细节）。

**Verify**
- Build: `xcodebuild -scheme SyncNos build`

---

## 不确定项（实现前需确认）
- Notion blocks 的“富文本 inline 标注”（bold/italic/link/code）是否要做为 P2.5（建议：先不做，等图片与顺序稳定后再做）？
- App 侧文章区域的交互：是否需要支持“复制保留格式/右键复制图片/打开原图”？（影响 WKWebView 配置与菜单策略）
