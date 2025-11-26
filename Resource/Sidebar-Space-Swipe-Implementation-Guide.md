# 侧边栏滑动切换实现指南

> 本文档提供可直接复用的代码实现，帮助你在 macOS/iOS 项目中实现类似 Nook 的侧边栏左右滑动切换功能。

## 目录

1. [快速开始](#1-快速开始)
2. [BigUIPaging 库集成](#2-biguipaging-库集成)
3. [核心代码实现](#3-核心代码实现)
4. [完整示例项目](#4-完整示例项目)
5. [自定义与扩展](#5-自定义与扩展)
6. [常见问题与解决方案](#6-常见问题与解决方案)

---

## 1. 快速开始

### 1.1 最小可行实现

只需 3 步即可实现基础的滑动切换功能：

```swift
import SwiftUI

// 步骤 1: 定义数据模型
struct Space: Identifiable {
    let id: UUID
    var name: String
    var icon: String
}

// 步骤 2: 创建主视图
struct SidebarView: View {
    @State private var activeIndex: Int = 0
    
    let spaces: [Space] = [
        Space(id: UUID(), name: "Personal", icon: "person.fill"),
        Space(id: UUID(), name: "Work", icon: "briefcase.fill"),
        Space(id: UUID(), name: "Projects", icon: "folder.fill")
    ]
    
    var body: some View {
        VStack {
            // 滑动区域
            PageView(selection: $activeIndex) {
                ForEach(spaces.indices, id: \.self) { index in
                    SpaceContentView(space: spaces[index])
                        .tag(index)
                }
            }
            .pageViewStyle(.scroll)
            
            // 指示器
            HStack {
                ForEach(spaces.indices, id: \.self) { index in
                    Circle()
                        .fill(index == activeIndex ? Color.primary : Color.secondary)
                        .frame(width: 8, height: 8)
                }
            }
            .padding()
        }
    }
}

// 步骤 3: 创建内容视图
struct SpaceContentView: View {
    let space: Space
    
    var body: some View {
        VStack {
            Image(systemName: space.icon)
                .font(.largeTitle)
            Text(space.name)
                .font(.headline)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
```

### 1.2 系统要求

| 平台 | 最低版本 |
|------|----------|
| macOS | 13.0+ |
| iOS | 16.0+ |

---

## 2. BigUIPaging 库集成

### 2.1 通过 Swift Package Manager 添加

在 `Package.swift` 中添加：

```swift
dependencies: [
    .package(url: "https://github.com/notsobigcompany/BigUIPaging.git", from: "0.0.1")
]
```

或在 Xcode 中：
1. File → Add Packages
2. 输入 URL: `https://github.com/notsobigcompany/BigUIPaging`
3. 选择版本并添加到目标

### 2.2 手动集成（推荐）

如果你需要更多控制权，可以直接将源码复制到项目中：

```
YourProject/
└── ThirdParty/
    └── BigUIPaging/
        └── Implementations/
            ├── PageView/
            │   ├── View/
            │   │   ├── PageView.swift
            │   │   └── PageView+Environment.swift
            │   ├── Platform/
            │   │   ├── PlatformPageView.swift
            │   │   ├── PlatformPageView+macOS.swift
            │   │   └── PlatformPageView+iOS.swift
            │   ├── Styles/
            │   │   ├── ScrollPageViewStyle.swift
            │   │   └── PlainPageViewStyle.swift
            │   └── Types/
            │       ├── PageViewStyle.swift
            │       ├── PageViewStyleConfiguration.swift
            │       ├── PageViewDirection.swift
            │       └── PageViewNavigateAction.swift
            └── Utils/
                ├── View+Inspect.swift
                └── View+Measure.swift
```

### 2.3 关键文件说明

| 文件 | 用途 |
|------|------|
| `PageView.swift` | 主视图组件 |
| `PlatformPageView+macOS.swift` | macOS 平台实现（NSPageController）|
| `PlatformPageView+iOS.swift` | iOS 平台实现（UIPageViewController）|
| `ScrollPageViewStyle.swift` | 滑动样式定义 |

---

## 3. 核心代码实现

### 3.1 数据模型

```swift
import Foundation
import SwiftUI

// MARK: - Space 模型
@MainActor
@Observable
public class Space: Identifiable {
    public let id: UUID
    var name: String
    var icon: String  // Emoji 或 SF Symbol 名称
    var activeTabId: UUID?
    
    init(
        id: UUID = UUID(),
        name: String,
        icon: String = "square.grid.2x2"
    ) {
        self.id = id
        self.name = name
        self.icon = icon
    }
}

// MARK: - Tab 模型
@MainActor
class Tab: ObservableObject, Identifiable {
    let id: UUID
    @Published var name: String
    @Published var url: URL
    @Published var spaceId: UUID?
    @Published var isActive: Bool = false
    
    init(id: UUID = UUID(), name: String, url: URL, spaceId: UUID? = nil) {
        self.id = id
        self.name = name
        self.url = url
        self.spaceId = spaceId
    }
}
```

### 3.2 状态管理器

```swift
import SwiftUI
import Combine

// MARK: - Space 管理器
@MainActor
class SpaceManager: ObservableObject {
    @Published var spaces: [Space] = []
    @Published var currentSpace: Space?
    @Published var tabsBySpace: [UUID: [Tab]] = [:]
    
    private var cancellables = Set<AnyCancellable>()
    
    init() {
        // 创建默认 Space
        let defaultSpace = Space(name: "Personal", icon: "person.fill")
        spaces.append(defaultSpace)
        currentSpace = defaultSpace
        tabsBySpace[defaultSpace.id] = []
    }
    
    // MARK: - Space 操作
    
    @discardableResult
    func createSpace(name: String, icon: String = "square.grid.2x2") -> Space {
        let space = Space(name: name, icon: icon)
        spaces.append(space)
        tabsBySpace[space.id] = []
        return space
    }
    
    func removeSpace(_ id: UUID) {
        guard spaces.count > 1 else { return }
        guard let index = spaces.firstIndex(where: { $0.id == id }) else { return }
        
        // 清理该 Space 的 Tabs
        tabsBySpace.removeValue(forKey: id)
        spaces.remove(at: index)
        
        // 如果删除的是当前 Space，切换到第一个
        if currentSpace?.id == id {
            currentSpace = spaces.first
        }
    }
    
    func setActiveSpace(_ space: Space) {
        guard spaces.contains(where: { $0.id == space.id }) else { return }
        currentSpace = space
    }
    
    func renameSpace(id: UUID, newName: String) {
        guard let space = spaces.first(where: { $0.id == id }) else { return }
        space.name = newName
    }
    
    func updateSpaceIcon(id: UUID, icon: String) {
        guard let space = spaces.first(where: { $0.id == id }) else { return }
        space.icon = icon
    }
    
    // MARK: - Tab 操作
    
    func tabs(in space: Space) -> [Tab] {
        tabsBySpace[space.id] ?? []
    }
    
    func addTab(_ tab: Tab, to spaceId: UUID) {
        tab.spaceId = spaceId
        if tabsBySpace[spaceId] == nil {
            tabsBySpace[spaceId] = []
        }
        tabsBySpace[spaceId]?.append(tab)
    }
    
    func removeTab(_ tabId: UUID) {
        for (spaceId, tabs) in tabsBySpace {
            if let index = tabs.firstIndex(where: { $0.id == tabId }) {
                tabsBySpace[spaceId]?.remove(at: index)
                break
            }
        }
    }
}
```

### 3.3 侧边栏主视图

```swift
import SwiftUI

struct SidebarView: View {
    @StateObject private var spaceManager = SpaceManager()
    @State private var activeSpaceIndex: Int = 0
    @State private var isSidebarHovered: Bool = false
    
    var body: some View {
        VStack(spacing: 8) {
            // 顶部栏
            SidebarHeader()
            
            // Space 滑动区域
            spacesPageView
            
            // 底部栏
            SidebarBottomBar(
                activeIndex: $activeSpaceIndex,
                onNewSpace: showSpaceCreationDialog
            )
            .environmentObject(spaceManager)
        }
        .padding(.vertical, 8)
        .frame(minWidth: 280)
        .onHover { isSidebarHovered = $0 }
    }
    
    // MARK: - Space 页面视图
    
    @ViewBuilder
    private var spacesPageView: some View {
        let spaces = spaceManager.spaces
        
        if spaces.isEmpty {
            emptyStateView
        } else {
            PageView(selection: $activeSpaceIndex) {
                ForEach(spaces.indices, id: \.self) { index in
                    SpaceContentView(
                        space: spaces[index],
                        isActive: spaceManager.currentSpace?.id == spaces[index].id
                    )
                    .environmentObject(spaceManager)
                    .tag(index)
                }
            }
            .pageViewStyle(.scroll)
            .onChange(of: activeSpaceIndex) { _, newIndex in
                handleSpaceIndexChange(newIndex)
            }
        }
    }
    
    private var emptyStateView: some View {
        VStack(spacing: 16) {
            Image(systemName: "square.grid.2x2")
                .font(.system(size: 48))
                .foregroundColor(.secondary)
            Text("No Spaces")
                .font(.title2)
                .fontWeight(.semibold)
            Button("Create Space") {
                showSpaceCreationDialog()
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    
    // MARK: - 事件处理
    
    private func handleSpaceIndexChange(_ newIndex: Int) {
        let spaces = spaceManager.spaces
        guard newIndex >= 0 && newIndex < spaces.count else { return }
        
        let space = spaces[newIndex]
        
        // 触发触觉反馈 (macOS)
        #if os(macOS)
        NSHapticFeedbackManager.defaultPerformer.perform(
            .alignment,
            performanceTime: .default
        )
        #endif
        
        // 激活 Space
        spaceManager.setActiveSpace(space)
    }
    
    private func showSpaceCreationDialog() {
        // 创建新 Space
        let newSpace = spaceManager.createSpace(
            name: "New Space",
            icon: "✨"
        )
        
        // 切换到新 Space
        if let index = spaceManager.spaces.firstIndex(where: { $0.id == newSpace.id }) {
            withAnimation {
                activeSpaceIndex = index
            }
        }
    }
}
```

### 3.4 Space 内容视图

```swift
import SwiftUI

struct SpaceContentView: View {
    @EnvironmentObject var spaceManager: SpaceManager
    let space: Space
    let isActive: Bool
    
    var body: some View {
        VStack(spacing: 4) {
            // Space 标题
            SpaceTitleView(space: space)
            
            // 标签列表
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 8) {
                    // 新建标签按钮
                    newTabButton
                    
                    // 标签列表
                    ForEach(spaceManager.tabs(in: space)) { tab in
                        TabRowView(tab: tab)
                    }
                }
                .padding(.horizontal, 8)
            }
            
            Spacer()
        }
        .padding(.horizontal, 8)
    }
    
    private var newTabButton: some View {
        Button {
            let newTab = Tab(
                name: "New Tab",
                url: URL(string: "about:blank")!,
                spaceId: space.id
            )
            spaceManager.addTab(newTab, to: space.id)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "plus")
                Text("New Tab")
                Spacer()
            }
        }
        .buttonStyle(SidebarButtonStyle())
    }
}

// MARK: - Space 标题视图

struct SpaceTitleView: View {
    @EnvironmentObject var spaceManager: SpaceManager
    let space: Space
    @State private var isHovering: Bool = false
    
    var body: some View {
        HStack(spacing: 6) {
            // 图标
            if isEmoji(space.icon) {
                Text(space.icon)
                    .font(.system(size: 12))
            } else {
                Image(systemName: space.icon)
                    .font(.system(size: 12))
            }
            
            // 名称
            Text(space.name)
                .font(.system(size: 14, weight: .semibold))
                .lineLimit(1)
            
            Spacer()
            
            // 菜单按钮
            if isHovering {
                Menu {
                    Button("Rename") { }
                    Button("Change Icon") { }
                    Divider()
                    Button("Delete", role: .destructive) {
                        spaceManager.removeSpace(space.id)
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.body.weight(.semibold))
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(isHovering ? Color.primary.opacity(0.1) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .onHover { isHovering = $0 }
    }
    
    private func isEmoji(_ string: String) -> Bool {
        string.unicodeScalars.contains { scalar in
            (scalar.value >= 0x1F300 && scalar.value <= 0x1F9FF) ||
            (scalar.value >= 0x2600 && scalar.value <= 0x26FF) ||
            (scalar.value >= 0x2700 && scalar.value <= 0x27BF)
        }
    }
}

// MARK: - Tab 行视图

struct TabRowView: View {
    @ObservedObject var tab: Tab
    @EnvironmentObject var spaceManager: SpaceManager
    @State private var isHovering: Bool = false
    
    var body: some View {
        HStack(spacing: 8) {
            // Favicon 占位符
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.secondary.opacity(0.3))
                .frame(width: 16, height: 16)
            
            // 标签名称
            Text(tab.name)
                .font(.system(size: 13))
                .lineLimit(1)
            
            Spacer()
            
            // 关闭按钮
            if isHovering {
                Button {
                    spaceManager.removeTab(tab.id)
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 36)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(tab.isActive ? Color.primary.opacity(0.15) : 
                      (isHovering ? Color.primary.opacity(0.08) : Color.clear))
        )
        .onHover { isHovering = $0 }
    }
}
```

### 3.5 底部栏与 Space 指示器

```swift
import SwiftUI

struct SidebarBottomBar: View {
    @EnvironmentObject var spaceManager: SpaceManager
    @Binding var activeIndex: Int
    let onNewSpace: () -> Void
    
    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            // 菜单按钮
            Button {
                // 打开菜单
            } label: {
                Image(systemName: "archivebox")
            }
            .buttonStyle(SidebarButtonStyle())
            
            // Space 指示器
            SpaceIndicatorList(activeIndex: $activeIndex)
                .frame(maxWidth: .infinity)
            
            // 新建按钮
            Menu {
                Button("New Space", systemImage: "square.grid.2x2") {
                    onNewSpace()
                }
                Button("New Folder", systemImage: "folder.badge.plus") { }
                Divider()
                Button("New Profile", systemImage: "person.badge.plus") { }
            } label: {
                Image(systemName: "plus")
            }
            .menuStyle(.button)
            .buttonStyle(SidebarButtonStyle())
        }
        .padding(.horizontal, 8)
    }
}

// MARK: - Space 指示器列表

struct SpaceIndicatorList: View {
    @EnvironmentObject var spaceManager: SpaceManager
    @Binding var activeIndex: Int
    @State private var availableWidth: CGFloat = 0
    
    private var layoutMode: LayoutMode {
        LayoutMode.determine(
            spacesCount: spaceManager.spaces.count,
            availableWidth: availableWidth
        )
    }
    
    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: 4) {
                ForEach(Array(spaceManager.spaces.enumerated()), id: \.element.id) { index, space in
                    SpaceIndicatorItem(
                        space: space,
                        isActive: index == activeIndex,
                        compact: layoutMode == .compact
                    ) {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            activeIndex = index
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .onAppear {
                availableWidth = geometry.size.width
            }
            .onChange(of: geometry.size.width) { _, newWidth in
                availableWidth = newWidth
            }
        }
        .frame(height: 32)
    }
    
    enum LayoutMode {
        case normal
        case compact
        
        static func determine(spacesCount: Int, availableWidth: CGFloat) -> Self {
            guard spacesCount > 0 else { return .normal }
            
            let buttonSize: CGFloat = 32
            let spacing: CGFloat = 4
            let normalWidth = CGFloat(spacesCount) * buttonSize + CGFloat(spacesCount - 1) * spacing
            
            return availableWidth >= normalWidth ? .normal : .compact
        }
    }
}

// MARK: - 单个 Space 指示器

struct SpaceIndicatorItem: View {
    let space: Space
    let isActive: Bool
    let compact: Bool
    let action: () -> Void
    
    @State private var isHovering: Bool = false
    
    private let dotSize: CGFloat = 6
    
    var body: some View {
        Button(action: action) {
            Group {
                if compact && !isActive {
                    // 紧凑模式：小圆点
                    Circle()
                        .fill(Color.primary.opacity(0.5))
                        .frame(width: dotSize, height: dotSize)
                } else {
                    // 正常模式：图标
                    if isEmoji(space.icon) {
                        Text(space.icon)
                            .font(.system(size: 14))
                    } else {
                        Image(systemName: space.icon)
                            .font(.system(size: 14))
                    }
                }
            }
            .frame(width: compact && !isActive ? dotSize : 32, height: 32)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(isHovering ? Color.primary.opacity(0.1) : Color.clear)
            )
            .opacity(isActive ? 1.0 : 0.7)
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
    }
    
    private func isEmoji(_ string: String) -> Bool {
        string.unicodeScalars.contains { scalar in
            (scalar.value >= 0x1F300 && scalar.value <= 0x1F9FF) ||
            (scalar.value >= 0x2600 && scalar.value <= 0x26FF) ||
            (scalar.value >= 0x2700 && scalar.value <= 0x27BF)
        }
    }
}
```

### 3.6 顶部栏

```swift
import SwiftUI

struct SidebarHeader: View {
    var body: some View {
        HStack(spacing: 8) {
            // 窗口控制按钮区域（macOS）
            #if os(macOS)
            Color.clear
                .frame(width: 70, height: 28)
            #endif
            
            // Toggle 侧边栏按钮
            Button {
                // 切换侧边栏
            } label: {
                Image(systemName: "sidebar.left")
            }
            .buttonStyle(SidebarButtonStyle())
            
            // AI 助手按钮
            Button {
                // 打开 AI 助手
            } label: {
                Image(systemName: "sparkle")
            }
            .buttonStyle(SidebarButtonStyle())
            
            Spacer()
            
            // 刷新按钮
            Button {
                // 刷新
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(SidebarButtonStyle())
        }
        .padding(.horizontal, 8)
        .frame(height: 28)
    }
}
```

### 3.7 按钮样式

```swift
import SwiftUI

struct SidebarButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) var colorScheme
    @Environment(\.isEnabled) var isEnabled
    @State private var isHovering: Bool = false
    
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14))
            .foregroundStyle(.primary)
            .frame(width: 32, height: 32)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(backgroundColor(isPressed: configuration.isPressed))
            )
            .opacity(isEnabled ? 1.0 : 0.3)
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
            .animation(.easeInOut(duration: 0.1), value: configuration.isPressed)
            .onHover { isHovering = $0 }
    }
    
    private func backgroundColor(isPressed: Bool) -> Color {
        if (isHovering || isPressed) && isEnabled {
            return Color.primary.opacity(colorScheme == .dark ? 0.2 : 0.1)
        }
        return Color.clear
    }
}
```

---

## 4. 完整示例项目

### 4.1 项目结构

```
SwipeableSidebar/
├── App/
│   └── SwipeableSidebarApp.swift
├── Models/
│   ├── Space.swift
│   └── Tab.swift
├── Managers/
│   └── SpaceManager.swift
├── Views/
│   ├── SidebarView.swift
│   ├── SpaceContentView.swift
│   ├── SpaceTitleView.swift
│   ├── TabRowView.swift
│   ├── SidebarHeader.swift
│   ├── SidebarBottomBar.swift
│   ├── SpaceIndicatorList.swift
│   └── SpaceIndicatorItem.swift
├── Styles/
│   └── SidebarButtonStyle.swift
└── ThirdParty/
    └── BigUIPaging/
        └── ... (库文件)
```

### 4.2 App 入口

```swift
import SwiftUI

@main
struct SwipeableSidebarApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        #if os(macOS)
        .windowStyle(.hiddenTitleBar)
        #endif
    }
}

struct ContentView: View {
    var body: some View {
        HStack(spacing: 0) {
            // 侧边栏
            SidebarView()
                .frame(width: 300)
            
            // 主内容区域
            Color.gray.opacity(0.1)
                .overlay {
                    Text("Main Content")
                        .foregroundStyle(.secondary)
                }
        }
    }
}
```

---

## 5. 自定义与扩展

### 5.1 自定义滑动样式

```swift
// 创建自定义样式
struct CustomPageViewStyle: PageViewStyle {
    func makeBody(configuration: Configuration) -> some View {
        ZStack {
            // 当前页面
            configuration.content(configuration.selection.wrappedValue)
            
            // 添加自定义效果
            // 例如：页面阴影、边缘渐变等
        }
    }
}

// 使用自定义样式
PageView(selection: $activeIndex) {
    // ...
}
.pageViewStyle(CustomPageViewStyle())
```

### 5.2 添加页面切换动画

```swift
// 在 PageView 外层添加动画
PageView(selection: $activeIndex) {
    ForEach(spaces.indices, id: \.self) { index in
        SpaceContentView(space: spaces[index])
            .transition(.asymmetric(
                insertion: .move(edge: .trailing).combined(with: .opacity),
                removal: .move(edge: .leading).combined(with: .opacity)
            ))
    }
}
.pageViewStyle(.scroll)
.animation(.spring(response: 0.3, dampingFraction: 0.8), value: activeIndex)
```

### 5.3 添加手势回调

```swift
PageView(selection: $activeIndex) {
    // ...
}
.pageViewStyle(.scroll)
.onChange(of: activeIndex) { oldIndex, newIndex in
    // 页面切换前
    print("Switching from \(oldIndex) to \(newIndex)")
    
    // 触觉反馈
    #if os(macOS)
    NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .default)
    #else
    let generator = UIImpactFeedbackGenerator(style: .light)
    generator.impactOccurred()
    #endif
    
    // 更新状态
    spaceManager.setActiveSpace(spaces[newIndex])
}
```

### 5.4 编程式导航

```swift
struct SidebarView: View {
    @Environment(\.navigatePageView) private var navigate
    @Environment(\.canNavigatePageView) private var canNavigate
    
    var body: some View {
        VStack {
            PageView(selection: $activeIndex) {
                // ...
            }
            .pageViewStyle(.scroll)
            .pageViewEnvironment()  // 启用导航环境
            
            // 导航按钮
            HStack {
                Button("Previous") {
                    navigate(.backwards)
                }
                .disabled(!canNavigate.contains(.backwards))
                
                Button("Next") {
                    navigate(.forwards)
                }
                .disabled(!canNavigate.contains(.forwards))
            }
        }
    }
}
```

### 5.5 垂直滑动

```swift
PageView(selection: $activeIndex) {
    // ...
}
.pageViewStyle(.scroll)
.pageViewOrientation(.vertical)  // 切换为垂直方向
```

---

## 6. 常见问题与解决方案

### 6.1 滑动手势不响应

**问题**：在 macOS 上，滑动手势没有反应。

**解决方案**：确保 `HostingView` 正确转发滚动事件：

```swift
class HostingView: NSHostingView<Content> {
    override func wantsForwardedScrollEvents(for axis: NSEvent.GestureAxis) -> Bool {
        return true  // 必须返回 true
    }
}
```

### 6.2 页面内容不更新

**问题**：切换 Space 后，内容没有更新。

**解决方案**：使用 `.id()` 修饰符强制刷新：

```swift
PageView(selection: $activeIndex) {
    ForEach(spaces.indices, id: \.self) { index in
        SpaceContentView(space: spaces[index])
            .id(spaces[index].id)  // 使用唯一 ID
    }
}
.id(refreshTrigger)  // 外层刷新触发器
```

### 6.3 状态不同步

**问题**：`activeIndex` 与实际显示的页面不一致。

**解决方案**：添加双向同步：

```swift
.onAppear {
    // 初始化时同步
    if let index = spaces.firstIndex(where: { $0.id == currentSpaceId }) {
        activeSpaceIndex = index
    }
}
.onChange(of: activeSpaceIndex) { _, newIndex in
    // 滑动后同步
    handleSpaceIndexChange(newIndex)
}
.onChange(of: currentSpaceId) { _, _ in
    // 外部更改后同步
    if let index = spaces.firstIndex(where: { $0.id == currentSpaceId }) {
        activeSpaceIndex = index
    }
}
```

### 6.4 内存泄漏

**问题**：页面过多时内存占用过高。

**解决方案**：BigUIPaging 内部已实现视图缓存，但可以进一步优化：

```swift
// 在 SpaceContentView 中使用 LazyVStack
ScrollView {
    LazyVStack {  // 使用 Lazy 懒加载
        ForEach(tabs) { tab in
            TabRowView(tab: tab)
        }
    }
}
```

### 6.5 动画卡顿

**问题**：切换时动画不流畅。

**解决方案**：

```swift
// 1. 条件动画
let shouldAnimate = isActiveWindow && !isTransitioning

.animation(
    shouldAnimate ? .easeInOut(duration: 0.2) : nil,
    value: activeIndex
)

// 2. 减少视图复杂度
// 在非活动页面隐藏复杂内容
if isActive {
    ComplexContentView()
} else {
    SimplePlaceholderView()
}
```

---

## 总结

通过本指南，你可以：

1. **快速集成** BigUIPaging 库实现滑动切换
2. **理解核心组件** 的实现原理
3. **复用代码模板** 快速搭建类似功能
4. **自定义扩展** 满足特定需求
5. **解决常见问题** 避免踩坑

关键要点：

- 使用 `PageView` + `.pageViewStyle(.scroll)` 实现滑动
- 通过 `$selection` 绑定实现双向数据流
- 使用 `onChange` 监听切换事件
- 注意平台差异（macOS 使用 NSPageController，iOS 使用 UIPageViewController）
- 合理使用视图缓存和懒加载优化性能

如有问题，请参考 Nook 项目源码或 BigUIPaging 官方文档。

