# Nook 侧边栏 Space 滑动切换架构分析文档

> 本文档详细分析 Nook 浏览器项目中侧边栏左右滑动切换 Space 功能的完整技术实现。

## 目录

1. [架构概览](#1-架构概览)
2. [核心组件详解](#2-核心组件详解)
3. [数据流与状态管理](#3-数据流与状态管理)
4. [BigUIPaging 库深度解析](#4-biguipaging-库深度解析)
5. [UI 组件层次结构](#5-ui-组件层次结构)
6. [关键实现细节](#6-关键实现细节)
7. [性能优化策略](#7-性能优化策略)

---

## 1. 架构概览

### 1.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        SpacesSideBarView                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      SidebarHeader                           ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       ││
│  │  │ Toggle Button│  │ Sparkle Icon │  │ Refresh Btn  │       ││
│  │  └──────────────┘  └──────────────┘  └──────────────┘       ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      PinnedGrid                              ││
│  │               (Favorites / Essential Tabs)                   ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    PageView (滑动容器)                        ││
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐         ││
│  │  │ Space 1 │←→│ Space 2 │←→│ Space 3 │←→│ Space N │         ││
│  │  │SpaceView│  │SpaceView│  │SpaceView│  │SpaceView│         ││
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘         ││
│  │           ← 左右滑动手势 (NSPageController) →                 ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    SidebarBottomBar                          ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       ││
│  │  │  Archivebox  │  │  SpacesList  │  │  Plus Menu   │       ││
│  │  │   (Menu)     │  │ (Indicators) │  │ (New Space)  │       ││
│  │  └──────────────┘  └──────────────┘  └──────────────┘       ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| UI 层 | SwiftUI | 声明式 UI 构建 |
| 滑动手势 | NSPageController (macOS) | 原生滑动手势支持 |
| 滑动手势 | UIPageViewController (iOS) | 原生滑动手势支持 |
| 状态管理 | @Observable / @EnvironmentObject | 响应式数据绑定 |
| 数据持久化 | TabManager | 统一的 Tab/Space 管理 |

### 1.3 文件结构

```
Nook/
├── Navigation/Sidebar/
│   ├── SpacesSideBarView.swift      # 侧边栏主视图
│   ├── SidebarHeader.swift          # 顶部栏
│   ├── SidebarBottomBar.swift       # 底部栏
│   ├── SpaceContextMenu.swift       # Space 右键菜单
│   └── SpacesList/
│       ├── SpacesList.swift         # Space 指示器列表
│       └── SpacesListItem.swift     # 单个 Space 指示器
│
├── Nook/Components/Sidebar/
│   ├── SpaceSection/
│   │   ├── SpaceView.swift          # Space 内容视图
│   │   ├── SpaceTitle.swift         # Space 标题
│   │   ├── SpaceTab.swift           # Tab 项视图
│   │   └── SpaceSeparator.swift     # 分隔符
│   └── PinnedButtons/
│       └── PinnedGrid.swift         # 固定标签网格
│
├── Nook/ThirdParty/BigUIPaging/     # 核心滑动库
│   └── Implementations/
│       ├── PageView/
│       │   ├── View/
│       │   │   ├── PageView.swift
│       │   │   └── PageView+Environment.swift
│       │   ├── Platform/
│       │   │   ├── PlatformPageView.swift
│       │   │   ├── PlatformPageView+macOS.swift
│       │   │   └── PlatformPageView+iOS.swift
│       │   ├── Styles/
│       │   │   └── ScrollPageViewStyle.swift
│       │   └── Types/
│       │       ├── PageViewStyle.swift
│       │       └── PageViewStyleConfiguration.swift
│       └── PageIndicator/
│
├── Nook/Models/Space/
│   └── Space.swift                  # Space 数据模型
│
└── Nook/Managers/
    ├── TabManager/
    │   └── TabManager.swift         # Tab/Space 管理
    └── BrowserManager/
        └── BrowserManager.swift     # 浏览器状态管理
```

---

## 2. 核心组件详解

### 2.1 SpacesSideBarView - 侧边栏主容器

这是整个侧边栏的入口组件，负责组织所有子组件。

```swift
struct SpacesSideBarView: View {
    @EnvironmentObject var browserManager: BrowserManager
    @Environment(BrowserWindowState.self) private var windowState
    
    // Space 导航状态
    @State private var activeSpaceIndex: Int = 0
    
    var body: some View {
        VStack(spacing: 8) {
            // 1. 顶部栏
            SidebarHeader(isSidebarHovered: isSidebarHovered)
            
            // 2. 固定标签网格
            PinnedGrid(width: windowState.sidebarContentWidth, profileId: effectiveProfileId)
            
            // 3. Space 页面视图（核心滑动区域）
            spacesPageView
            
            // 4. 底部栏
            SidebarBottomBar(...)
        }
    }
}
```

**关键职责：**
- 组织侧边栏的整体布局
- 管理 `activeSpaceIndex` 状态
- 处理 Space 切换时的回调

### 2.2 PageView - 滑动容器核心

PageView 是实现左右滑动的核心组件，来自 BigUIPaging 第三方库。

```swift
private func spacesContent(spaces: [Space]) -> some View {
    PageView(selection: $activeSpaceIndex) {
        ForEach(spaces.indices, id: \.self) { index in
            makeSpaceView(for: spaces[index], index: index)
        }
    }
    .pageViewStyle(.scroll)  // 启用滑动样式
    .onChange(of: activeSpaceIndex) { _, newIndex in
        handleSpaceIndexChange(newIndex, spaces: spaces)
    }
}
```

**核心特性：**
- 通过 `$activeSpaceIndex` 双向绑定当前选中的 Space
- `.pageViewStyle(.scroll)` 启用水平滑动手势
- 自动处理滑动动画和过渡效果

### 2.3 SpaceView - 单个 Space 的内容视图

每个 Space 的完整内容视图，包含标题、固定标签和普通标签列表。

```swift
struct SpaceView: View {
    let space: Space
    let isActive: Bool
    @Binding var isSidebarHovered: Bool
    
    var body: some View {
        VStack(spacing: 4) {
            // Space 标题
            SpaceTitle(space: space)
            
            // 主内容容器（可滚动）
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 8) {
                    pinnedTabsSection      // 固定到 Space 的标签
                    newTabButtonSection    // 新建标签按钮
                    regularTabsList        // 普通标签列表
                }
            }
        }
    }
}
```

### 2.4 SpacesList - Space 指示器

底部的 Space 指示器，显示所有 Space 的图标，支持点击切换。

```swift
struct SpacesList: View {
    private var layoutMode: SpacesListLayoutMode {
        SpacesListLayoutMode.determine(
            spacesCount: browserManager.tabManager.spaces.count,
            availableWidth: availableWidth
        )
    }
    
    var body: some View {
        HStack(spacing: 0) {
            ForEach(visibleSpaces) { space in
                SpacesListItem(
                    space: space,
                    isActive: windowState.currentSpaceId == space.id,
                    compact: layoutMode == .compact
                )
            }
        }
    }
}
```

**自适应布局：**
- 当空间充足时，显示完整图标（normal 模式）
- 当空间不足时，非活动 Space 显示为小圆点（compact 模式）

---

## 3. 数据流与状态管理

### 3.1 状态层次结构

```
┌─────────────────────────────────────────────────────────────┐
│                     BrowserManager                           │
│  - tabManager: TabManager                                    │
│  - currentProfile: Profile?                                  │
│  - gradientColorManager: GradientColorManager               │
│  └──────────────────────────────────────────────────────────┤
│                          │                                   │
│                          ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐│
│  │                    TabManager                             ││
│  │  - spaces: [Space]              # 所有 Space              ││
│  │  - currentSpace: Space?         # 当前活动 Space          ││
│  │  - tabsBySpace: [UUID: [Tab]]   # Space 到 Tab 的映射     ││
│  │  - currentTab: Tab?             # 当前活动 Tab            ││
│  └──────────────────────────────────────────────────────────┘│
│                          │                                   │
│                          ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐│
│  │               BrowserWindowState                          ││
│  │  - currentSpaceId: UUID?        # 窗口当前 Space ID       ││
│  │  - activeTabForSpace: [UUID: UUID]  # Space 到活动 Tab    ││
│  │  - sidebarWidth: CGFloat        # 侧边栏宽度              ││
│  └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Space 切换数据流

```
用户滑动手势
     │
     ▼
┌─────────────────────┐
│ NSPageController    │  ← macOS 原生滑动手势处理
│ (BigUIPaging)       │
└─────────────────────┘
     │
     ▼ pageControllerDidEndLiveTransition
┌─────────────────────┐
│ PageView Binding    │  ← selection: $activeSpaceIndex
│ activeSpaceIndex    │
└─────────────────────┘
     │
     ▼ onChange(of: activeSpaceIndex)
┌─────────────────────┐
│ handleSpaceIndex-   │
│ Change()            │
└─────────────────────┘
     │
     ▼
┌─────────────────────┐
│ browserManager.     │
│ setActiveSpace()    │
└─────────────────────┘
     │
     ├──▶ 更新 windowState.currentSpaceId
     ├──▶ 更新渐变色背景
     ├──▶ 切换到目标 Tab
     └──▶ 触发触觉反馈
```

### 3.3 关键状态同步代码

```swift
// SpacesSideBarView.swift
private func handleSpaceIndexChange(_ newIndex: Int, spaces: [Space]) {
    guard newIndex >= 0 && newIndex < spaces.count else { return }
    
    let space = spaces[newIndex]
    
    // 触发触觉反馈
    NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .default)
    
    // 激活 Space
    browserManager.setActiveSpace(space, in: windowState)
}

// BrowserManager.swift
func setActiveSpace(_ space: Space, in windowState: BrowserWindowState) {
    // 1. 更新窗口的当前 Space
    windowState.currentSpaceId = space.id
    windowState.currentProfileId = space.profileId ?? currentProfile?.id
    
    // 2. 更新渐变色背景
    updateGradient(for: windowState, to: space.gradient, animate: true)
    
    // 3. 查找并激活目标 Tab
    if let tab = targetTab {
        selectTab(tab, in: windowState)
    }
}
```

---

## 4. BigUIPaging 库深度解析

### 4.1 库概述

BigUIPaging 是一个 SwiftUI 分页视图库，提供了跨平台的滑动分页功能。

**支持的样式：**

| 样式 | iOS | macOS | 说明 |
|------|-----|-------|------|
| `.plain` | ✅ | ✅ | 无手势，仅编程控制 |
| `.scroll` | ✅ | ✅ | 滑动切换（Nook 使用此样式）|
| `.book` | ✅ | - | 翻书效果 |
| `.historyStack` | - | ✅ | 历史堆叠效果 |
| `.bookStack` | - | ✅ | 书籍堆叠效果 |
| `.cardDeck` | ✅ | - | 卡片堆叠效果 |

### 4.2 macOS 平台实现

在 macOS 上，BigUIPaging 使用 `NSPageController` 实现滑动功能：

```swift
// PlatformPageView+macOS.swift
extension PlatformPageView: NSViewControllerRepresentable {
    
    func makeNSViewController(context: Context) -> NSPageController {
        let pageController = NSPageController()
        pageController.delegate = context.coordinator
        pageController.transitionStyle = .horizontalStrip  // 水平滑动
        return pageController
    }
    
    // Coordinator 处理滑动完成回调
    class Coordinator: NSObject, NSPageControllerDelegate {
        func pageControllerDidEndLiveTransition(_ pageController: NSPageController) {
            pageController.completeTransition()
            // 更新 selection binding
            parent.selection = selectedValue(in: pageController) ?? parent.selection
        }
    }
}
```

**关键实现细节：**

1. **滑动事件转发**：
```swift
class HostingView: NSHostingView<Content> {
    // 确保滑动事件能传递到 NSPageController
    override func wantsForwardedScrollEvents(for axis: NSEvent.GestureAxis) -> Bool {
        return true
    }
}
```

2. **动态加载页面**：
```swift
func makeArrangedObjects(around value: SelectionValue, limit: Int = 3) -> ([Any], Int) {
    var currentValue = value
    var previousObjects = [SelectionValue]()
    // 向前查找
    while let previousValue = previous(currentValue), previousObjects.count < limit {
        previousObjects.insert(previousValue, at: 0)
        currentValue = previousValue
    }
    // 向后查找
    currentValue = value
    var nextObjects = [value]
    while let nextValue = next(currentValue), nextObjects.count <= limit {
        nextObjects.append(nextValue)
        currentValue = nextValue
    }
    let allObjects = previousObjects + nextObjects
    let selectedIndex = previousObjects.count
    return (allObjects, selectedIndex)
}
```

3. **视图缓存机制**：
```swift
class Coordinator: NSObject, NSPageControllerDelegate {
    var viewCache = [SelectionValue: NSView]()
    
    func makeView(for value: SelectionValue) -> NSView {
        if let cached = viewCache[value] {
            return cached
        }
        let view = PlatformPageView.HostingView(rootView: parent.content(value))
        viewCache[value] = view
        return view
    }
    
    func flushViewCache(in pageController: NSPageController) {
        guard let currentValues = pageController.arrangedObjects as? [SelectionValue] else { return }
        for value in viewCache.keys {
            if !currentValues.contains(value) {
                viewCache.removeValue(forKey: value)
            }
        }
    }
}
```

### 4.3 iOS 平台实现

在 iOS 上，BigUIPaging 使用 `UIPageViewController` 实现滑动功能：

```swift
// PlatformPageView+iOS.swift
extension PlatformPageView: UIViewControllerRepresentable {
    
    func makeUIViewController(context: Context) -> UIPageViewController {
        let pageViewController = UIPageViewController(
            transitionStyle: .scroll,           // 滑动样式
            navigationOrientation: .horizontal,  // 水平方向
            options: [.interPageSpacing: NSNumber(value: spacing)]
        )
        pageViewController.delegate = context.coordinator
        pageViewController.dataSource = context.coordinator
        return pageViewController
    }
    
    class Coordinator: NSObject, UIPageViewControllerDelegate, UIPageViewControllerDataSource {
        // 提供前一页
        func pageViewController(_ pageViewController: UIPageViewController,
                               viewControllerBefore viewController: UIViewController) -> UIViewController? {
            guard let container = viewController as? ContainerViewController,
                  let previous = parent.previous(container.value) else { return nil }
            return makeViewController(previous)
        }
        
        // 提供后一页
        func pageViewController(_ pageViewController: UIPageViewController,
                               viewControllerAfter viewController: UIViewController) -> UIViewController? {
            guard let container = viewController as? ContainerViewController,
                  let next = parent.next(container.value) else { return nil }
            return makeViewController(next)
        }
        
        // 滑动完成回调
        func pageViewController(_ pageViewController: UIPageViewController,
                               didFinishAnimating finished: Bool,
                               previousViewControllers: [UIViewController],
                               transitionCompleted completed: Bool) {
            guard completed else { return }
            parent.selection = selectedValue(in: pageViewController) ?? parent.selection
        }
    }
}
```

### 4.4 PageView API 使用方式

```swift
// 方式 1: 使用 ForEach 数据源
@State private var selection: Int = 0

PageView(selection: $selection) {
    ForEach(0..<10, id: \.self) { index in
        Text("Page \(index)")
    }
}
.pageViewStyle(.scroll)

// 方式 2: 使用 next/previous 闭包
PageView(selection: $selection) { value in
    value + 1  // next
} previous: { value in
    value > 0 ? value - 1 : nil  // previous
} content: { value in
    Text("Page \(value)")
}
.pageViewStyle(.scroll)
```

---

## 5. UI 组件层次结构

### 5.1 组件树状图

```
SpacesSideBarView
├── SidebarHeader
│   ├── MacButtonsView (窗口控制按钮)
│   ├── Toggle Sidebar Button
│   ├── Sparkle Button (AI 助手)
│   └── NavButtonsView / URLBarView
│
├── PinnedGrid
│   └── PinnedTile[] (固定标签)
│
├── PageView (滑动容器)
│   └── SpaceView[] (每个 Space)
│       ├── SpaceTitle
│       │   ├── Space Icon (Emoji/SF Symbol)
│       │   ├── Space Name
│       │   └── Ellipsis Menu
│       │
│       ├── ScrollView
│       │   ├── pinnedTabsSection
│       │   │   └── SpaceTab[] (固定到 Space 的标签)
│       │   │
│       │   ├── SpaceSeparator
│       │   │   └── Clear Button
│       │   │
│       │   ├── newTabButtonSection
│       │   │   └── "+ New Tab" Button
│       │   │
│       │   └── regularTabsList
│       │       └── SpaceTab[] (普通标签)
│       │
│       └── Spacer (可拖动区域)
│
├── MediaControlsView
│
├── SidebarUpdateNotification
│
└── SidebarBottomBar
    ├── Menu Button (archivebox)
    │   └── DownloadIndicator
    ├── SpacesList (Space 指示器)
    │   └── SpacesListItem[]
    └── Plus Menu
        ├── New Space
        ├── New Folder
        └── New Profile
```

### 5.2 SpaceTab 组件详解

每个标签页的视图组件：

```swift
struct SpaceTab: View {
    @ObservedObject var tab: Tab
    var action: () -> Void
    var onClose: () -> Void
    var onMute: () -> Void
    
    var body: some View {
        Button(action: handleTap) {
            HStack(spacing: 8) {
                // Favicon
                ZStack {
                    tab.favicon
                        .resizable()
                        .frame(width: 14, height: 14)
                    
                    // 未加载指示器
                    if tab.isUnloaded {
                        Image(systemName: "arrow.down.circle.fill")
                            .offset(x: 6, y: -6)
                    }
                }
                
                // 音频控制按钮
                if tab.hasAudioContent || tab.isAudioMuted {
                    audioButton
                }
                
                // 标签名称 / 重命名输入框
                if tab.isRenaming {
                    TextField("", text: $tab.editingName)
                } else {
                    Text(tab.name)
                        .lineLimit(1)
                }
                
                Spacer()
                
                // 关闭按钮 (悬停时显示)
                if isHovering {
                    closeButton
                }
            }
            .padding(.horizontal, 10)
            .frame(height: 36)
            .background(backgroundColor)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .contextMenu { contextMenuContent }
    }
}
```

### 5.3 SpacesListItem 组件详解

底部 Space 指示器的单个项目：

```swift
struct SpacesListItem: View {
    let space: Space
    let isActive: Bool
    let compact: Bool
    
    private let dotSize: CGFloat = 6
    
    var body: some View {
        Button {
            browserManager.setActiveSpace(space, in: windowState)
        } label: {
            spaceIcon
                .opacity(isActive ? 1.0 : 0.7)
        }
        .buttonStyle(SpaceListItemButtonStyle())
        .contextMenu { spaceContextMenu }
    }
    
    @ViewBuilder
    private var spaceIcon: some View {
        if compact && !isActive {
            // 紧凑模式：显示小圆点
            Circle()
                .fill(iconColor)
                .frame(width: dotSize, height: dotSize)
        } else {
            // 正常模式：显示图标
            if isEmoji(space.icon) {
                Text(space.icon)
            } else {
                Image(systemName: space.icon)
            }
        }
    }
}
```

---

## 6. 关键实现细节

### 6.1 Space 切换时的状态同步

```swift
// SpacesSideBarView.swift
private func spacesContent(spaces: [Space]) -> some View {
    PageView(selection: $activeSpaceIndex) {
        ForEach(spaces.indices, id: \.self) { index in
            makeSpaceView(for: spaces[index], index: index)
        }
    }
    .pageViewStyle(.scroll)
    .id(activeTabRefreshTrigger)  // 强制刷新
    .onAppear {
        // 初始化时同步索引
        if let targetIndex = spaces.firstIndex(where: { $0.id == windowState.currentSpaceId }) {
            activeSpaceIndex = targetIndex
        }
    }
    .onChange(of: activeSpaceIndex) { _, newIndex in
        // 滑动完成后同步状态
        handleSpaceIndexChange(newIndex, spaces: spaces)
    }
    .onChange(of: windowState.currentSpaceId) { _, _ in
        // 外部 Space 切换时同步索引
        if let targetIndex = spaces.firstIndex(where: { $0.id == windowState.currentSpaceId }) {
            activeSpaceIndex = targetIndex
        }
        activeTabRefreshTrigger.toggle()
    }
}
```

### 6.2 触觉反馈

```swift
private func handleSpaceIndexChange(_ newIndex: Int, spaces: [Space]) {
    guard newIndex >= 0 && newIndex < spaces.count else { return }
    
    let space = spaces[newIndex]
    
    // 触发触觉反馈（macOS）
    NSHapticFeedbackManager.defaultPerformer.perform(
        .alignment,
        performanceTime: .default
    )
    
    browserManager.setActiveSpace(space, in: windowState)
}
```

### 6.3 自适应布局模式

```swift
enum SpacesListLayoutMode {
    case normal    // 完整图标
    case compact   // 小圆点（非活动）+ 图标（活动）
    
    static func determine(spacesCount: Int, availableWidth: CGFloat) -> Self {
        guard spacesCount > 0 else { return .normal }
        
        let buttonSize: CGFloat = 32.0
        let minSpacing: CGFloat = 4.0
        let dotSize: CGFloat = 6.0
        
        // 计算正常模式所需宽度
        let normalMinWidth = CGFloat(spacesCount) * buttonSize + 
                            CGFloat(spacesCount - 1) * minSpacing
        
        // 计算紧凑模式所需宽度
        let totalDots = spacesCount - 1
        let compactMinWidth = buttonSize + 
                             CGFloat(totalDots) * dotSize + 
                             CGFloat(totalDots) * minSpacing
        
        if availableWidth >= normalMinWidth {
            return .normal
        } else {
            return .compact
        }
    }
}
```

### 6.4 Space 创建流程

```swift
// SidebarBottomBar.swift - Plus 菜单
Menu {
    Button("New Space", systemImage: "square.grid.2x2") {
        onNewSpaceTap()
    }
    Button("New Folder", systemImage: "folder.badge.plus") {
        browserManager.tabManager.createFolder(for: currentSpace.id)
    }
    Divider()
    Button("New Profile", systemImage: "person.badge.plus") {
        // TODO: 显示 Profile 创建对话框
    }
} label: {
    Label("Actions", systemImage: "plus")
}

// SpacesSideBarView.swift - 创建对话框
private func showSpaceCreationDialog() {
    browserManager.dialogManager.showDialog(
        SpaceCreationDialog(
            onCreate: { name, icon, profileId in
                let finalName = name.isEmpty ? "New Space" : name
                let finalIcon = icon.isEmpty ? "✨" : icon
                
                let newSpace = browserManager.tabManager.createSpace(
                    name: finalName,
                    icon: finalIcon
                )
                
                if let profileId = profileId {
                    browserManager.tabManager.assign(spaceId: newSpace.id, toProfile: profileId)
                }
                
                // 切换到新创建的 Space
                if let targetIndex = browserManager.tabManager.spaces.firstIndex(where: { $0.id == newSpace.id }) {
                    activeSpaceIndex = targetIndex
                }
                
                browserManager.dialogManager.closeDialog()
            },
            onCancel: {
                browserManager.dialogManager.closeDialog()
            }
        )
    )
}
```

### 6.5 拖拽支持

```swift
// SpaceTab 的拖拽修饰符
.onTabDrag(tab.id, draggedItem: $draggedItem)
.opacity(draggedItem == tab.id ? 0.25 : 1.0)

// 放置区域
.onDrop(
    of: [.text],
    delegate: SidebarSectionDropDelegateSimple(
        itemsCount: { tabs.count },
        draggedItem: $draggedItem,
        targetSection: .spaceRegular(space.id),
        tabManager: browserManager.tabManager,
        onDropEntered: {
            NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)
        }
    )
)
```

---

## 7. 性能优化策略

### 7.1 视图缓存

BigUIPaging 内部使用视图缓存来避免重复创建：

```swift
class Coordinator {
    var viewCache = [SelectionValue: NSView]()
    
    func makeView(for value: SelectionValue) -> NSView {
        if let cached = viewCache[value] {
            // 更新已缓存视图的内容
            if let hostingView = cached as? HostingView {
                hostingView.rootView = parent.content(value)
            }
            return cached
        }
        // 创建新视图并缓存
        let view = HostingView(rootView: parent.content(value))
        viewCache[value] = view
        return view
    }
}
```

### 7.2 懒加载

只加载当前页面及其相邻页面：

```swift
func makeArrangedObjects(around value: SelectionValue, limit: Int = 3) -> ([Any], Int) {
    // 只预加载前后各 3 个页面
    // 当滑动到边缘时动态加载更多
}
```

### 7.3 动画优化

```swift
// 只在活动窗口执行动画
let shouldAnimate = (windowRegistry.activeWindow?.id == windowState.id) && 
                   !browserManager.isTransitioningProfile

.animation(
    shouldAnimate ? .easeInOut(duration: 0.18) : nil,
    value: essentialsCount
)
```

### 7.4 ID 刷新策略

```swift
// 使用复合 ID 强制刷新
.id(space.id.uuidString + "-w\(Int(windowState.sidebarContentWidth))")

// 使用触发器刷新
@State private var activeTabRefreshTrigger: Bool = false

.id(activeTabRefreshTrigger)
.onChange(of: windowState.currentSpaceId) { _, _ in
    activeTabRefreshTrigger.toggle()
}
```

---

## 总结

Nook 的侧边栏 Space 滑动切换功能通过以下关键技术实现：

1. **BigUIPaging 库**：提供跨平台的滑动分页功能
   - macOS 使用 `NSPageController`
   - iOS 使用 `UIPageViewController`

2. **双向数据绑定**：`@State activeSpaceIndex` 与 `PageView.selection` 绑定

3. **状态同步**：通过 `onChange` 监听器保持 UI 状态与数据模型同步

4. **自适应布局**：Space 指示器根据可用空间自动切换显示模式

5. **性能优化**：视图缓存、懒加载、条件动画等策略

这种架构设计使得 Space 切换流畅自然，同时保持了良好的代码可维护性和扩展性。