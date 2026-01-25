# GoodLinks 文章流式加载与缓存方案

**目标：** 缩短 GoodLinks 详情页的首屏内容显示时间，在本地持久保存获取到的文章内容，并保留现有的错误/重试行为。

**非目标：**
- 不更改 Notion 同步逻辑。
- 不更改 HTML 提取规则，除非为支持流式加载确实需要修改。
- 不新增本地化字符串。

## 当前审计（持久化）
- `WebArticleFetcher` 使用 `WebArticleCacheService`（SwiftData）根据 URL 持久化 `ArticleFetchResult`。
- 缓存默认开启，可在 GoodLinks 设置中切换。
- 缓存存储：`Application Support/SyncNos/web_article_cache.store`（7 天 TTL）。
- 当前 UI 仅在完整抓取并提取后渲染，因此不存在流式显示。

## 建议方案（推荐）
1. **缓存优先 + stale-while-revalidate：**
   - 若存在缓存，立即渲染缓存内容。
   - 随后绕过缓存获取最新内容，完成后更新 UI 与缓存。
2. **流式回退：**
   - 若无缓存，在提取器运行期间展示一个加载原始 URL 的 `WKWebView`。
   - 一旦提取到 HTML 后，用提取后的 HTML 替换流式视图。
3. **错误处理：**
   - 保持现有的错误与重试逻辑。
   - 若提取失败，需决定是继续保留流式视图还是仅显示错误提示。

---

## 方案 A（主方案）

### 任务 1：为 `WebArticleFetcher` 添加绕过缓存的能力
**文件：**
- 修改： `SyncNos/Services/WebArticle/WebArticleFetcher.swift`
- 修改： `SyncNos/Services/WebArticle/WebArticleFetcher.swift` 协议
- 修改： `SyncNos/Services/DataSources-To/Notion/Sync/Adapters/GoodLinksNotionAdapter.swift`
- 修改： `SyncNos/ViewModels/GoodLinks/GoodLinksDetailViewModel.swift`

**步骤：**
- 在 `WebArticleFetcherProtocol` 中扩展类似 `fetchArticle(url:cachePolicy:)` 或 `fetchArticleFresh(url:)` 的 API。
- 在 `WebArticleFetcher` 中实现绕过缓存的分支（当强制刷新时跳过 `cacheService.getArticle`）。
- 更新调用方以在合适场景使用默认（缓存）行为。

### 任务 2：GoodLinks 详情页的缓存优先渲染
**文件：**
- 修改： `SyncNos/ViewModels/GoodLinks/GoodLinksDetailViewModel.swift`

**步骤：**
- 将 `WebArticleCacheServiceProtocol` 注入到 `GoodLinksDetailViewModel`。
- 加载时先尝试读取缓存，若命中则立即设置 `article` 与状态。
- 启动后台的绕过缓存抓取；完成后更新 UI 与缓存。

### 任务 3：流式回退视图
**文件：**
- 新增： `SyncNos/Views/Components/Web/URLWebView.swift`（或扩展 `HTMLWebView`）
- 修改： `SyncNos/Views/Components/Cards/ArticleContentCardView.swift`
- 修改： `SyncNos/ViewModels/GoodLinks/GoodLinksDetailViewModel.swift`
- 修改： `SyncNos/Views/GoodLinks/GoodLinksDetailView.swift`

**步骤：**
- 新增渲染状态（例如 `.streaming(url: URL)`）。
- 当缓存未命中且抓取进行中时，使用 `WKWebView.load(URLRequest)` 显示流式视图。
- 抓取完成后切换为提取到的 HTML。

### 任务 4：连线与重试
**文件：**
- 修改： `SyncNos/Views/GoodLinks/GoodLinksDetailView.swift`

**步骤：**
- 将新状态映射到 `ArticleContentCardView`。
- 重试操作触发带绕过缓存的刷新抓取。

### 任务 5：验证
- 构建： `xcodebuild -scheme SyncNos build`
- 手动验证：
  - 打开已缓存文章：内容应立即出现。
  - 打开新文章：快速显示流式视图，然后切换为提取的 HTML。
  - 关闭缓存设置后：先显示流式视图，抓取完成后显示提取的 HTML。
  - 失败情况：重试应生效且不会崩溃。

---

## 开放问题
- 是否将流式 URL 视图作为回退？（推荐：是）
- 抓取后是否切换为提取的 HTML？（推荐：是）
- 若提取失败，应保留流式视图还是仅显示错误？
