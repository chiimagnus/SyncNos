# GoodLinks 全文按需加载/按需卸载重构计划

## 背景与目标

### 问题分析

当前实现存在以下问题：

1. **全文内容在 Detail 加载时立即加载**：在 `GoodLinksDetailView.swift` 的 `.task(id: linkId)` 中，`loadContent(for: linkId)` 会立即加载全文，不管用户是否要展开查看。

2. **全文内容始终驻留内存**：`detailViewModel.content` 一旦加载就会一直保存在内存中，直到切换到另一个 link 或调用 `clear()`。

3. **展开/折叠不影响全文加载**：`articleIsExpanded` 只控制 UI 显示（`lineLimit`），不控制全文的加载/卸载。

4. **ArticleContentCardView 接收 contentText 而非按需加载**：当前设计是父组件把全文传给子组件，子组件只负责展示。

### 重构目标

1. **按需加载**：只有当用户展开全文卡片时才加载全文内容
2. **按需卸载**：折叠全文卡片或切换 selection 时立即释放全文字符串（`content = nil`）
3. **内存优化**：未展开时内存不应因全文加载而飙升

### 验证标准

- 手动：未展开时内存不应因全文加载而飙升
- 展开 → 加载（显示加载指示器）
- 折叠 → 内容释放（内存图/Allocations 观察内存下降）
- 切换 selection → 内容释放

---

## 重构计划

### P1：ViewModel 层重构（核心逻辑）

**涉及文件**：`SyncNos/ViewModels/GoodLinks/GoodLinksDetailViewModel.swift`

#### 1.1 新增全文加载状态枚举

```swift
enum ContentLoadState: Equatable {
    case notLoaded          // 未加载（默认状态）
    case loading            // 加载中
    case loaded             // 已加载
    case error(String)      // 加载失败
}
```

#### 1.2 新增 Published 属性

```swift
@Published var contentLoadState: ContentLoadState = .notLoaded
```

#### 1.3 重构 `loadContent(for:)` 为私有方法

- 保留原有逻辑，但标记为私有
- 在加载前设置 `contentLoadState = .loading`
- 加载成功设置 `contentLoadState = .loaded`
- 加载失败设置 `contentLoadState = .error(message)`

#### 1.4 新增 `loadContentOnDemand()` 公开方法

```swift
/// 按需加载全文（仅在展开时调用）
func loadContentOnDemand() async {
    guard let linkId = currentLinkId else { return }
    guard contentLoadState == .notLoaded || contentLoadState.isError else { return }
    await loadContent(for: linkId)
}
```

#### 1.5 新增 `unloadContent()` 方法

```swift
/// 卸载全文内容，释放内存
func unloadContent() {
    contentFetchTask?.cancel()
    contentFetchTask = nil
    content = nil
    contentLoadState = .notLoaded
}
```

#### 1.6 修改 `clear()` 方法

确保 `contentLoadState` 也被重置为 `.notLoaded`。

---

### P2：View 层重构

**涉及文件**：`SyncNos/Views/GoodLinks/GoodLinksDetailView.swift`

#### 2.1 移除 `.task(id:)` 中的 `loadContent` 调用

```swift
// 修改前
.task(id: linkId) {
    detailViewModel.clear()
    await detailViewModel.loadHighlights(for: linkId)
    await detailViewModel.loadContent(for: linkId)  // ← 移除此行
    // ...
}

// 修改后
.task(id: linkId) {
    detailViewModel.clear()
    await detailViewModel.loadHighlights(for: linkId)
    externalIsSyncing = viewModel.syncingLinkIds.contains(linkId)
    if !externalIsSyncing { externalSyncProgress = nil }
}
```

#### 2.2 监听 `articleIsExpanded` 变化，触发加载/卸载

```swift
.onChange(of: articleIsExpanded) { _, expanded in
    if expanded {
        // 展开时按需加载全文
        Task {
            await detailViewModel.loadContentOnDemand()
        }
    } else {
        // 折叠时卸载全文，释放内存
        detailViewModel.unloadContent()
        withAnimation {
            proxy.scrollTo("goodlinksDetailTop", anchor: .top)
        }
    }
}
```

#### 2.3 在切换 selection 时确保卸载

```swift
.onChange(of: selectedLinkId) { _, _ in
    articleIsExpanded = false
    detailViewModel.unloadContent()  // ← 新增
    externalIsSyncing = false
    externalSyncProgress = nil
}
```

#### 2.4 修改全文内容卡片渲染逻辑

根据 `contentLoadState` 显示不同状态：

```swift
// 全文内容卡片
switch detailViewModel.contentLoadState {
case .notLoaded:
    // 显示折叠状态的卡片（带展开按钮）
    ArticleContentCardView(
        wordCount: 0,
        overrideWidth: debouncedLayoutWidth > 0 ? debouncedLayoutWidth : nil,
        measuredWidth: $measuredLayoutWidth,
        revealThreshold: nil,
        customSlot: AnyView(
            Text("点击展开加载全文内容")
                .foregroundColor(.secondary)
        ),
        isExpanded: $articleIsExpanded
    )
    
case .loading:
    // 显示加载中状态
    ArticleContentCardView(
        wordCount: 0,
        overrideWidth: debouncedLayoutWidth > 0 ? debouncedLayoutWidth : nil,
        measuredWidth: $measuredLayoutWidth,
        revealThreshold: nil,
        customSlot: AnyView(
            HStack(spacing: 8) {
                ProgressView().scaleEffect(0.8)
                Text("Loading article content...")
            }
        ),
        isExpanded: $articleIsExpanded
    )
    
case .loaded:
    if let contentRow = detailViewModel.content,
       let fullText = contentRow.content,
       !fullText.isEmpty {
        ArticleContentCardView(
            wordCount: contentRow.wordCount,
            contentText: fullText,
            overrideWidth: debouncedLayoutWidth > 0 ? debouncedLayoutWidth : nil,
            measuredWidth: $measuredLayoutWidth,
            isExpanded: $articleIsExpanded
        )
    } else {
        // 无内容状态
        // ...
    }
    
case .error(let message):
    // 显示错误状态
    ArticleContentCardView(
        wordCount: 0,
        overrideWidth: debouncedLayoutWidth > 0 ? debouncedLayoutWidth : nil,
        measuredWidth: $measuredLayoutWidth,
        revealThreshold: nil,
        customSlot: AnyView(
            VStack(spacing: 8) {
                Text("Failed to load article content")
                    .foregroundColor(.red)
                Text(message)
                    .scaledFont(.caption)
                    .foregroundColor(.secondary)
                Button("Retry") {
                    Task {
                        await detailViewModel.loadContentOnDemand()
                    }
                }
            }
        ),
        isExpanded: $articleIsExpanded
    )
}
```

---

### P3：ArticleContentCardView 优化（可选增强）

**涉及文件**：`SyncNos/Views/Components/Cards/ArticleContentCardView.swift`

#### 3.1 支持加载状态回调（可选）

如果需要更优雅的交互，可以在 `ArticleContentCardView` 中：

- 添加 `onExpandRequest: (() -> Void)?` 回调
- 在未加载状态下点击展开按钮时触发回调

但根据当前设计，通过 View 层监听 `articleIsExpanded` 变化已经足够。

---

### P4：刷新通知处理优化

**涉及文件**：`SyncNos/Views/GoodLinks/GoodLinksDetailView.swift`

修改 `RefreshBooksRequested` 通知处理，确保刷新时不自动加载全文：

```swift
.onReceive(NotificationCenter.default.publisher(for: Notification.Name("RefreshBooksRequested")).receive(on: DispatchQueue.main)) { _ in
    if let linkId = selectedLinkId, !linkId.isEmpty {
        detailViewModel.clear()
        Task {
            await detailViewModel.loadHighlights(for: linkId)
            // 注意：不调用 loadContent，保持折叠状态
            // 如果当前是展开状态，才加载全文
            if articleIsExpanded {
                await detailViewModel.loadContentOnDemand()
            }
        }
    }
}
```

---

## 实现顺序与验证

### 第一阶段：P1（ViewModel 核心逻辑）
1. 添加 `ContentLoadState` 枚举
2. 添加 `contentLoadState` 属性
3. 重构 `loadContent` 方法
4. 添加 `loadContentOnDemand()` 方法
5. 添加 `unloadContent()` 方法
6. 修改 `clear()` 方法
7. **验证**：编译通过，无语法错误

### 第二阶段：P2（View 层集成）
1. 移除 `.task(id:)` 中的 `loadContent` 调用
2. 修改 `onChange(of: articleIsExpanded)` 逻辑
3. 修改 `onChange(of: selectedLinkId)` 逻辑
4. 修改全文卡片渲染逻辑（根据状态显示不同 UI）
5. **验证**：编译通过，运行测试展开/折叠/切换行为

### 第三阶段：P4（刷新通知优化）
1. 修改 `RefreshBooksRequested` 处理逻辑
2. **验证**：刷新后全文不自动加载，展开状态下刷新后全文重新加载

---

## 内存验证方法

1. **Xcode Memory Graph**：
   - 在展开前截图内存使用
   - 展开后观察内存增长
   - 折叠后观察内存是否回落
   - 切换 selection 后观察内存是否回落

2. **Instruments Allocations**：
   - 跟踪 `String` 分配
   - 确认折叠/切换后大字符串被释放

---

## 风险与注意事项

1. **用户体验**：展开时需要等待加载，应显示加载指示器
2. **快速切换**：用户快速切换时需要取消旧任务，避免旧结果写入新状态（已有 `currentLinkId` 校验）
3. **同步流程**：同步时需要加载全文内容，确保适配器可以直接从数据库获取，不依赖 ViewModel 的 `content` 属性

---

## 文件清单

| 文件 | 修改类型 |
|------|----------|
| `SyncNos/ViewModels/GoodLinks/GoodLinksDetailViewModel.swift` | 核心重构 |
| `SyncNos/Views/GoodLinks/GoodLinksDetailView.swift` | View 集成 |
| `SyncNos/Views/Components/Cards/ArticleContentCardView.swift` | 无需修改（可选增强） |

