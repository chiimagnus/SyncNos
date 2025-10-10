<!-- 31f864b2-c05e-4e39-9f7a-37d7264a165f 83630d97-e82f-451a-bf87-f19bb44c2521 -->
# Extract Shared UI for Detail Views (low-risk, fast)

## Scope

- Keep `AppleBookDetailView` and `GoodLinksDetailView`.
- Extract duplicated UI/behavior into shared components/modifiers/utilities.
- No changes to existing ViewModels/services/contracts.

## Files to Add (Shared)

- `SyncNos/Views/Shared/SharedSyncToolbar.swift`
  - A tiny SwiftUI view showing sync progress or an action button.
  - Props: `isSyncing: Bool`, `progressText: String?`, `action: () -> Void`, `label: String = "Sync"`, `help: String = "Sync highlights to Notion"`.
- `SyncNos/Views/Shared/ResizeFreezeModifier.swift`
  - ViewModifier wiring `LiveResizeObserver` and freeze logic.
  - API:
    - `extension View { func resizeFreeze(isResizing: Binding<Bool>, measuredWidth: Binding<CGFloat>, frozenWidth: Binding<CGFloat?>) -> some View }`
- `SyncNos/Views/Shared/SyncAlertWrapper.swift`
  - Wrapper view that attaches a unified "Sync Error" alert and shows it only for non-success messages.
  - Props: `syncMessage: String?`, `errorMessage: String? = nil`, `successKeywords: [String] = ["同步完成", "增量同步完成", "全量同步完成"]`, `content`.
- `SyncNos/Views/Shared/HighlightHelpers.swift`
  - Helpers:
    - `func ibooksColor(for style: Int) -> Color`
    - `func goodLinksColor(for code: Int) -> Color`
    - `func dateString(from date: Date?, dateStyle: DateFormatter.Style = .short, timeStyle: DateFormatter.Style = .short) -> String?`
    - `func dateString(fromUnix ts: Double, localeId: String = "zh_CN") -> String`
    - `func isSuccessSyncMessage(_ message: String, keywords: [String]) -> Bool`

## Edits to Existing Files

- `SyncNos/Views/AppleBooks/AppleBookDetailView.swift`
  - Replace inline toolbar UI with `SharedSyncToolbar`.
  - Replace `highlightStyleColor` with `ibooksColor(for:)`.
  - Replace `dateFormatter` usage with `dateString(from:)`.
  - Attach `.resizeFreeze(isResizing: $isLiveResizing, measuredWidth: $measuredLayoutWidth, frozenWidth: $frozenLayoutWidth)` at the outer container.
  - Wrap the view content inside `SyncAlertWrapper(syncMessage: viewModel.syncMessage)` and remove duplicated alert/show state logic.
  - Keep the GeometryReader overlays that update `measuredLayoutWidth` (no change) and paging button.
- `SyncNos/Views/GoodLinks/GoodLinksDetailView.swift`
  - Replace inline toolbar with `SharedSyncToolbar`.
  - Replace highlight color switch with `goodLinksColor(for:)`.
  - Replace local timestamp/date format with `dateString(fromUnix:)`.
  - Attach `.resizeFreeze(...)` modifier as above.
  - Wrap content with `SyncAlertWrapper(syncMessage: viewModel.syncMessage, errorMessage: viewModel.errorMessage)` and remove the existing alert + onChange blocks.
  - Keep overlays that set `measuredLayoutWidth` (including in `ArticleContentCardView`).

## Non-Goals

- No changes to `ViewModels`/services.
- No generic `MainDetailView`.

## References (where to replace)

- AppleBooks toolbar and sync state block:
```166:191:SyncNos/Views/AppleBooks/AppleBookDetailView.swift
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if viewModel.isSyncing {
                    HStack(spacing: 8) {
                        ProgressView().scaleEffect(0.8)
                        if let progress = viewModel.syncProgressText {
                            Text(progress).font(.caption)
                        } else {
                            Text("Syncing...").font(.caption)
                        }
                    }
                    .help("Sync in progress")
                } else {
                    if let book = selectedBook {
                        Button {
                            Task {
                                viewModel.syncSmart(book: book, dbPath: viewModelList.annotationDatabasePath)
                            }
                        } label: {
                            Label("Sync", systemImage: "arrow.triangle.2.circlepath")
                        }
                        .help("Sync highlights to Notion")
                    }
                }
            }
        }
```

- GoodLinks toolbar and sync state block:
```223:249:SyncNos/Views/GoodLinks/GoodLinksDetailView.swift
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if viewModel.isSyncing {
                    HStack(spacing: 8) {
                        ProgressView().scaleEffect(0.8)
                        if let progress = viewModel.syncProgressText {
                            Text(progress).font(.caption)
                        } else {
                            Text("Syncing...").font(.caption)
                        }
                    }
                    .help("Sync in progress")
                } else {
                    if let link = viewModel.links.first(where: { $0.id == linkId }) {
                        Button {
                            Task {
                                viewModel.syncSmart(link: link)
                            }
                        } label: {
                            Label("Sync", systemImage: "arrow.triangle.2.circlepath")
                        }
                        .help("Sync highlights to Notion")
                    }
                }
            }
        }
```

- AppleBooks sync alert and message handling:
```192:217:SyncNos/Views/AppleBooks/AppleBookDetailView.swift
        .alert("Sync Error", isPresented: $showingSyncError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(syncErrorMessage)
        }
        .onChange(of: viewModel.syncMessage) { newMessage in
            if let message = newMessage {
                let successKeywords = ["同步完成", "增量同步完成", "全量同步完成"]
                let isSuccess = successKeywords.contains { message.localizedCaseInsensitiveContains($0) }
                if !isSuccess {
                    syncErrorMessage = message
                    showingSyncError = true
                }
            }
        }
```

- GoodLinks sync alert and message handling:
```268:288:SyncNos/Views/GoodLinks/GoodLinksDetailView.swift
        .alert("Sync Error", isPresented: $showingSyncError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(syncErrorMessage)
        }
        .onChange(of: viewModel.syncMessage) { newMessage in
            if let message = newMessage {
                let successKeywords = ["同步完成", "增量同步完成", "全量同步完成"]
                let isSuccess = successKeywords.contains { message.localizedCaseInsensitiveContains($0) }
                if !isSuccess {
                    syncErrorMessage = message
                    showingSyncError = true
                }
            }
        }
        .onChange(of: viewModel.errorMessage) { newError in
            if let err = newError, !err.isEmpty {
                syncErrorMessage = err
                showingSyncError = true
            }
        }
```


## Acceptance

- UI and behaviors unchanged visually.
- Both detail views compile without their previous duplicated blocks.
- Shared components fully covered by existing usages.

### To-dos

- [ ] Create `SyncNos/ViewModels/DetailSyncable.swift` with the protocol for shared sync/error state
- [ ] Implement `SyncNos/Views/Components/DetailContainerView.swift` that encapsulates toolbar/alert/resize/geometry logic and exposes hooks for header/content/sync/loadMore
- [ ] Refactor `SyncNos/Views/AppleBooks/AppleBookDetailView.swift` to use `DetailContainerView` and pass `syncAction`/`loadMore` closures
- [ ] Refactor `SyncNos/Views/GoodLinks/GoodLinksDetailView.swift` to use `DetailContainerView` and pass `syncAction` closure
- [ ] Add `: DetailSyncable` conformance declarations to `AppleBookDetailViewModel` and `GoodLinksViewModel` (no behavioural changes)
- [ ] Run linter/build and manually verify UI behaviour and sync/alert flows