# 搜索功能（全局 Cmd+K + Detail ⌘F）实施计划
> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:**  
实现两套搜索：  
1) **全局搜索面板（⌘K）**：默认跨全部启用数据源搜索，支持切换“只搜某一数据源”；结果粒度为**具体命中的文本块**（高亮/笔记/消息/GoodLinks 已缓存正文），同时保留“仅标题/作者/URL/标签命中”的结果；结果按**相关度优先**排序；选中后可跳转并在 Detail 内定位。  
2) **Detail 内搜索（⌘F）**：各 Detail 顶部常驻搜索框；可在当前 Detail 内筛选/定位并高亮匹配内容。

**Non-goals（非目标）:**  
- 不做离线全文索引库/倒排索引（首版不引入额外 DB / 搜索引擎）。  
- 不做跨窗口搜索（暂只在主窗口 MainListView 生效）。  
- 不修改/不新增国际化资源（新增文案先用中文硬编码）。

**Approach（方案 / 核心权衡）:**  
- 采用“**按数据源 Provider 实时搜索 + 结果流式返回 + 统一导航协议**”的 MVP：  
  - Apple Books / GoodLinks：优先用 SQLite `LIKE` 直接搜高亮/笔记（性能稳定）。  
  - GoodLinks 正文：仅搜 **已缓存** `textContent`（WebArticleCacheService），不为搜索即时抓取。  
  - WeRead / Dedao / Chats：优先用各自 CacheService 读取数据并在内存匹配，带 **limit + early stop + 并发控制**。  
- 搜索匹配与高亮统一走 `SearchTextMatcher`（多 token / range 计算 / snippet 生成），UI 统一用 `HighlightedText`（AttributedString）渲染高亮。  
- 跳转采用 `NotificationCenter` + `MainListView` 统一处理：选中结果后切换数据源、设置 selection，并把“Detail 需要滚动定位的目标”注入到对应 Detail。

**Acceptance（验收）:**  
- ⌘K：打开/关闭全局搜索面板；输入后 300ms 内开始返回结果；输入变化会取消旧任务；支持“全部/指定数据源”筛选。  
- 全局结果：至少包含（1）命中高亮/笔记/消息/正文文本块的结果（2）仅标题/作者/URL/标签命中的结果；结果按相关度优先排序；每条结果展示 snippet 且 snippet 内高亮命中。  
- 回车/点击结果：自动切到对应数据源与条目，并在 Detail 内滚动定位到命中的块；命中块在 Detail 中高亮。  
- ⌘F：在当前 Detail 聚焦搜索框；输入后当前 Detail 中匹配内容高亮，并可用上下一个按钮（或 ⌘G/⌘⇧G，可选）定位。  

---

## Plan A（主方案）

### P1：基础类型 + 文本匹配/高亮（可复用）

#### Task 1: 定义全局搜索的模型与导航目标
**Files:**
- Create: `SyncNos/Models/Search/GlobalSearchModels.swift`
- Modify: `SyncNos/Models/Core/NotificationNames.swift`

**内容要点:**
- `GlobalSearchScope`：`.allEnabled` / `.source(ContentSource)`  
- `GlobalSearchResultKind`：`.textBlock` / `.titleOnly`  
- `GlobalSearchResult`（Sendable/Identifiable）：  
  - `source: ContentSource`  
  - `containerId`（书/文章/对话 id）  
  - `blockId`（高亮 id / 消息 id / “正文命中块 id”）可选  
  - `containerTitle` / `containerSubtitle`（作者/域名等）  
  - `snippet`（纯文本） + `matches: [Range<String.Index>]`（相对 snippet 的 ranges）  
  - `timestamp`（用于同分排序）  
  - `score`（相关度）  
- `GlobalSearchNavigationTarget`：用于跳转/定位（source + containerId + blockId + kind）
- 新增通知：  
  - `.globalSearchPanelToggleRequested`（⌘K）  
  - `.globalSearchNavigateRequested`（选中结果，userInfo 带 target）

**验证:**
- Run: `xcodebuild -scheme SyncNos build`

#### Task 2: 实现统一的文本匹配与 snippet 生成
**Files:**
- Create: `SyncNos/Services/Search/SearchTextMatcher.swift`

**实现要点:**
- 输入：`text`（原文）、`query`（用户输入）  
- 规则（MVP）：  
  - `query` 按空白拆成 tokens（`"foo bar"` => `["foo","bar"]`），AND 匹配：所有 token 都需命中；单 token 则按子串匹配。  
  - options：`.caseInsensitive` + `.diacriticInsensitive`（英文更友好，中文不受影响）。  
- 输出：  
  - `MatchResult(isMatch: Bool, matchRanges: [Range<Int>], snippet: String, snippetRanges: [Range<Int>], scoreParts: …)`  
  - snippet：围绕“最紧凑的命中窗口”截取（例如目标窗口 140–220 字符），保证命中尽量集中。  
- 相关度：  
  - `matchCountWeight`（命中次数越多越靠前）  
  - `compactnessWeight`（命中窗口越短越靠前）  
  - `fieldBoost`（标题/作者/标签命中可加权，但低于正文命中）

**Swift 示例（接口草案）:**
```swift
struct SearchTextMatch: Sendable {
    let snippet: String
    let snippetRanges: [Range<Int>]
    let matchCount: Int
    let compactness: Int
}

enum SearchTextMatcher {
    static func match(text: String, query: String, snippetLimit: Int = 180) -> SearchTextMatch?
}
```

**验证:**
- Run: `xcodebuild -scheme SyncNos build`

#### Task 3: SwiftUI 高亮渲染组件
**Files:**
- Create: `SyncNos/Views/Components/Search/HighlightedText.swift`

**实现要点:**
- 输入：`text: String` + `ranges: [Range<Int>]`（UTF16 index 或 Character index 需统一）  
- 输出：`Text(AttributedString)`，为命中范围设置背景色（例如 `.yellow.opacity(0.35)`）与适当的圆角样式（可选用 `NSAttributedString.Key.backgroundColor`）。

**验证:**
- Run: `xcodebuild -scheme SyncNos build`

---

### P2：全局搜索引擎（Provider + 聚合 + 取消）

#### Task 4: 定义 Provider 协议与全局搜索引擎
**Files:**
- Create: `SyncNos/Services/Search/GlobalSearchProvider.swift`
- Create: `SyncNos/Services/Search/GlobalSearchEngine.swift`
- Modify: `SyncNos/Services/Core/DIContainer.swift`
- Modify: `SyncNos/Services/Core/Protocols.swift`（如需暴露协议）

**实现要点:**
- Provider 协议（按源实现）：  
  - `func search(query: String, scope: GlobalSearchScope, limit: Int) -> AsyncThrowingStream<GlobalSearchResult, Error>`
- Engine：  
  - 根据 scope 选择启用源 providers  
  - `withThrowingTaskGroup` 并发启动 provider 搜索  
  - merge stream，持续更新 UI  
  - query 变化时取消旧任务（在 `GlobalSearchViewModel` 保存 `Task`）

**验证:**
- Run: `xcodebuild -scheme SyncNos build`

#### Task 5: 各数据源 Provider（先实现“可工作”，再做性能优化）
**Files:**
- Create: `SyncNos/Services/Search/Providers/AppleBooksSearchProvider.swift`
- Create: `SyncNos/Services/Search/Providers/GoodLinksSearchProvider.swift`
- Create: `SyncNos/Services/Search/Providers/WeReadSearchProvider.swift`
- Create: `SyncNos/Services/Search/Providers/DedaoSearchProvider.swift`
- Create: `SyncNos/Services/Search/Providers/ChatsSearchProvider.swift`
- Modify: `SyncNos/Services/DataSources-From/AppleBooks/DatabaseQueryService.swift`（新增 search query）
- Modify: `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksQueryService.swift`（新增 search query）

**策略（MVP）:**
- Apple Books：  
  - SQL：`WHERE text LIKE ? OR note LIKE ?`，返回 `assetId + highlightUUID + snippet`  
  - title/author 命中：基于 `AppleBooksViewModel.books/displayBooks` 做额外匹配生成 `.titleOnly`
- GoodLinks：  
  - SQL：高亮 `content/note LIKE ?`  
  - 标题/作者/URL/标签：基于 `GoodLinksViewModel.links`  
  - 正文：对每个 link 先尝试 `WebArticleCacheService.getArticle(url:)`，命中则生成 `.textBlock`（blockId 可用 `article:<hash>:<matchIndex>`）
- WeRead / Dedao：  
  - cacheService：按 bookId 取缓存 highlights（必要时只取前 N 本/按最近更新排序 early stop）  
  - note/text/reviewContents 全部参与匹配，返回 `highlightId`  
  - 标题/作者命中：基于各自 `ViewModel.displayBooks`
- Chats：  
  - `ChatCacheService.fetchMessagesPage` 倒序分页扫描（避免全量）  
  - 命中生成 `.textBlock`，blockId 使用 `message.id.uuidString`  
  - 标题命中：对话名命中生成 `.titleOnly`

**验证:**
- Run: `xcodebuild -scheme SyncNos build`

---

### P3：全局搜索面板 UI（⌘K）+ 结果跳转

#### Task 6: 全局搜索面板 ViewModel
**Files:**
- Create: `SyncNos/ViewModels/Search/GlobalSearchViewModel.swift`

**实现要点:**
- `@Published var query: String`（debounce 200–300ms）  
- `@Published var scope: GlobalSearchScope`（All/单源）  
- `@Published var results: [GlobalSearchResult]`（流式 append + 去重 + 按 score 排序）  
- `@Published var selectedIndex: Int`（键盘上下选择）  
- 每次 query 变化：cancel 旧 task，清空 results，启动 engine 搜索  

**验证:**
- Run: `xcodebuild -scheme SyncNos build`

#### Task 7: 全局搜索面板 View（Notion 风格）
**Files:**
- Create: `SyncNos/Views/Components/Search/GlobalSearchPanelView.swift`
- Modify: `SyncNos/Views/Components/Main/MainListView.swift`
- Modify: `SyncNos/Views/Commands/ViewCommands.swift` 或 `SyncNos/Views/Commands/EditCommands.swift`

**实现要点:**
- 触发：新增菜单命令“全局搜索”（⌘K）→ post `.globalSearchPanelToggleRequested`  
- MainListView：  
  - `@State var isGlobalSearchPresented = false`  
  - 监听 toggle 通知展示 overlay（半透明背景 + 居中面板）  
- 面板交互：  
  - 顶部输入框（自动 focus）  
  - 数据源筛选 chips（All + enabled sources）  
  - 结果列表（支持 ↑↓，回车触发 navigate 通知）  
  - 每条结果展示：source icon + containerTitle + snippet（HighlightedText）  

**验证:**
- Run: `xcodebuild -scheme SyncNos build`

#### Task 8: 统一跳转与定位（MainListView 负责）
**Files:**
- Modify: `SyncNos/Views/Components/Main/MainListView.swift`
- Modify: `SyncNos/Views/Components/Main/MainListView+DetailViews.swift`
- Create: `SyncNos/Models/Search/DetailScrollTarget.swift`

**实现要点:**
- MainListView 监听 `.globalSearchNavigateRequested`：  
  - 切换 `contentSourceRawValue`  
  - `selectionState.setSelection(for:source, ids:[containerId])`  
  - 设置 `@State var pendingDetailScrollTarget: DetailScrollTarget?`（包含 source/containerId/blockId/kind）  
- DetailViews：向各 DetailView 追加可选参数 `scrollTarget: DetailScrollTarget?`（只对匹配 source 生效）

**验证:**
- Run: `xcodebuild -scheme SyncNos build`

---

### P4：Detail 搜索（⌘F）+ 高亮 + 定位

#### Task 9: 通用 DetailSearchBar 组件
**Files:**
- Create: `SyncNos/Views/Components/Search/DetailSearchBar.swift`

**实现要点:**
- UI：magnifier + TextField + clear + 上/下一个按钮  
- 输出：`searchText` binding + `onNext` / `onPrev` / `onFocusRequested`  
- 不做 i18n：按钮/placeholder 先硬编码中文。

**验证:**
- Run: `xcodebuild -scheme SyncNos build`

#### Task 10: 各 DetailView 接入搜索栏与滚动定位
**Files:**
- Modify: `SyncNos/Views/AppleBooks/AppleBooksDetailView.swift`
- Modify: `SyncNos/Views/GoodLinks/GoodLinksDetailView.swift`
- Modify: `SyncNos/Views/WeRead/WeReadDetailView.swift`
- Modify: `SyncNos/Views/Dedao/DedaoDetailView.swift`
- Modify: `SyncNos/Views/Chats/ChatDetailView.swift`
- Modify: `SyncNos/Views/Components/Cards/HighlightCardView.swift`

**实现要点（通用）:**
- 每个 Detail 顶部插入 `DetailSearchBar`（放在 InfoHeaderCard 之后或 toolbar 中，保持“常驻”）。  
- 将 `searchText` 传给卡片：  
  - `HighlightCardView` 新增可选参数：`highlightQuery: String?`，内部使用 `SearchTextMatcher` 生成 ranges 并用 `HighlightedText` 渲染 content/note/reviewContents。  
- 定位：  
  - `ScrollViewReader`：给每个 block 卡片增加 `.id(blockId)`  
  - 当 `scrollTarget` 或 `activeMatchIndex` 变化时，`proxy.scrollTo(blockId, anchor: .center)`  

**GoodLinks 正文（HTMLWebView）高亮:**
- Modify: `SyncNos/Views/Components/Web/HTMLWebView.swift`（增加 `searchQuery` / `activeMatchIndex` 可选参数）  
- Web 侧注入 JS：清理旧标记 → 用 `<mark class="syncnos-search-hit">` 包裹命中 → 可按 index 滚动到对应 mark。

**Chats:**
- 在 `ChatDetailView` 的消息气泡渲染处使用 `HighlightedText` 高亮命中；定位用 message.id。

**⌘F 聚焦规则:**
- 在 Commands 中新增 “Find in Detail”（⌘F）→ post `.detailSearchFocusRequested`  
- 各 DetailView 监听该通知并聚焦自己的搜索框（仅当当前 source 的 Detail 可见）。

**验证:**
- Run: `xcodebuild -scheme SyncNos build`
- Manual:  
  - 打开某本书/文章/对话，⌘F 聚焦搜索框，输入词可见高亮；点击上下一个可跳转。

---

### P5：相关度排序与性能收尾（可选增强）

#### Task 11: 结果去重、稳定排序与限流
**Files:**
- Modify: `SyncNos/ViewModels/Search/GlobalSearchViewModel.swift`
- Modify: `SyncNos/Services/Search/GlobalSearchEngine.swift`

**实现要点:**
- 去重 key：`source + containerId + blockId + kind`  
- 每个 provider 限制 `limit`（例如 200），Engine 总上限（例如 500）  
- 并发控制：WeRead/Dedao/Chats 扫描时限制并发（例如 `TaskGroup` 最大 4）  
- UI 更新节流：results append 后用 `@MainActor` + `Task.sleep(16ms)` 合并刷新（避免频繁重排）

**验证:**
- Run: `xcodebuild -scheme SyncNos build`

---

## 不确定项（需要你确认或我在实现时自定）
- 全局搜索 panel：是否需要“字段筛选”（只搜标题/只搜内容）？MVP 可以先不做，仅保留数据源筛选。  
- Detail 搜索的“筛选策略”：默认是“只高亮不隐藏不匹配项”，还是“只展示命中项”？（计划按“只高亮 + 可选下一处定位”实现；如你希望默认过滤，我会把过滤做成开关。）  
- ⌘G/⌘⇧G：是否需要作为“下一个/上一个命中”的快捷键（可选增强）。  

