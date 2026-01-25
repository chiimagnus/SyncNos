# GoodLinks Article Full Content Implementation Plan

> Execution: use `executing-plans` to implement and verify.

**Goal:** Always load and display full article HTML (including images) in the GoodLinks detail view, with no preview or expand/collapse state.

**Non-goals:**
- Do not change web fetching/parsing behavior.
- Do not change Notion sync logic.
- Do not add new settings or localization work.

**Approach:**
- Load full article content as soon as the detail view opens.
- Remove expand/collapse UI and any preview-only rendering.
- Always render HTML when available; otherwise render full plain text.
- Keep loading, empty, error, and retry behaviors intact.

**Acceptance:**
- GoodLinks detail shows full HTML content (images included) without user action.
- Expand/Collapse controls are removed.
- Loading/error states remain visible and retry works.
- Highlights list behavior remains unchanged.

---

## Plan A (Primary)

### P1: Simplify content loading and UI

#### Task 1: Load full content on entry

**Files:**
- Modify: `SyncNos/ViewModels/GoodLinks/GoodLinksDetailViewModel.swift`
- Modify: `SyncNos/Views/GoodLinks/GoodLinksDetailView.swift`

**Step 1: Replace preview flow with a single full-load path**

```swift
@Published var contentLoadState: ContentLoadState = .notLoaded

func loadContent(for link: GoodLinksLinkRow) async {
    contentFetchTask?.cancel()
    contentFetchTask = nil
    contentLoadState = .loadingFull
    do {
        let result = try await urlFetcher.fetchArticle(url: link.url)
        article = result
        contentLoadState = result.textContent.isEmpty ? .empty : .loaded
    } catch URLFetchError.contentNotFound {
        article = nil
        contentLoadState = .empty
    } catch {
        contentLoadState = .error(error.localizedDescription)
    }
}
```

**Step 2: Update GoodLinksDetailView to call `loadContent(for:)` on entry/refresh**
- Remove `articleIsExpanded` state and its `onChange` handler.
- Remove calls to `loadContentPreview`, `loadContentOnDemand`, and `unloadContent`.
- Ensure `mapToArticleLoadState` no longer returns `.preview`.

**Step 3: Verify build**
Run: `xcodebuild -scheme SyncNos build`
Expected: BUILD SUCCEEDED

#### Task 2: Remove expand/collapse UI and always render full content

**Files:**
- Modify: `SyncNos/Views/Components/Cards/ArticleContentCardView.swift`

**Step 1: Remove `isExpanded` binding, toggle button, and `collapsedLineLimit`**

**Step 2: Always render HTML when available; otherwise render full text**

```swift
if let htmlContent, !htmlContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
    HTMLWebView(
        html: htmlContent,
        baseURL: htmlBaseURL,
        openLinksInExternalBrowser: true,
        contentHeight: $htmlContentHeight
    )
    .frame(height: max(320, htmlContentHeight))
} else {
    Text(content)
        .scaledFont(.body)
        .textSelection(.enabled)
        .fixedSize(horizontal: false, vertical: true)
}
```

**Step 3: Verify build**
Run: `xcodebuild -scheme SyncNos build`
Expected: BUILD SUCCEEDED

### P1 Regression / Manual Verification
- Build: `xcodebuild -scheme SyncNos build`
- Manual: Open a GoodLinks article that previously showed collapsed content; confirm images appear without any expand action, no Expand/Collapse UI is visible, and error+retry still works (e.g., offline).

## Open Questions
- None.
