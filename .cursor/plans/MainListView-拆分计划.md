# MainListView 拆分计划

> **状态**：🔄 进行中（2025-12-25）  
> **目标**：将 1196 行的 MainListView.swift 拆分为更小的、职责单一的模块

---

## 一、当前结构分析

### 1.1 文件概览

| 区域 | 行号范围 | 行数 | 说明 |
|------|----------|------|------|
| State Objects | 11-68 | ~57 | ViewModel、Selection、Alert 状态 |
| Initialization | 69-78 | ~9 | 初始化 DedaoVM |
| Computed Properties | 83-108 | ~25 | contentSource、enabledSources |
| Body | 109-157 | ~48 | 主视图结构 |
| Private Methods | 158-178 | ~20 | 辅助方法 |
| Main Content | 179-319 | ~140 | masterColumn、detailColumn、alerts |
| **Keyboard Monitor** | 320-594 | **~274** | 键盘事件处理 ⚠️ 最大 |
| Focus Helpers | 595-630 | ~35 | 焦点相关辅助方法 |
| Navigation | 631-643 | ~12 | navigateToSettings |
| **Sync & Refresh** | 644-763 | **~119** | 同步和刷新逻辑 |
| Master Column | 764-784 | ~20 | 侧边栏容器 |
| Toolbar Menu | 785-807 | ~22 | 工具栏菜单入口 |
| **Filter Menus** | 808-1020 | **~212** | 各数据源筛选菜单 |
| **Detail Column** | 1022-1176 | **~154** | 各数据源详情视图 |
| Sync Methods | 1177-1196 | ~19 | 同步方法 |

### 1.2 拆分优先级

| 优先级 | 区域 | 行数 | 拆分方式 | 理由 |
|--------|------|------|----------|------|
| P1 | Filter Menus | ~212 | 独立扩展文件 | 职责单一，无状态依赖 |
| P2 | Keyboard Monitor | ~274 | 独立 Helper 类 | 复杂逻辑，可复用 |
| P3 | Detail Column | ~154 | 独立扩展文件 | 职责单一 |
| P4 | Sync & Refresh | ~119 | 独立扩展文件 | 业务逻辑集中 |

---

## 二、拆分方案

### 2.1 Filter Menus → `MainListView+FilterMenus.swift`

**内容**：
- `appleBooksFilterMenu`
- `goodLinksFilterMenu`
- `weReadFilterMenu`
- `dedaoFilterMenu`
- `wechatChatFilterMenu`

**优点**：
- 纯 View 代码，无复杂状态
- 每个数据源的筛选逻辑独立
- 添加新数据源时只需在此文件添加

---

### 2.2 Keyboard Monitor → `MainListView+KeyboardMonitor.swift`

**内容**：
- `startKeyboardMonitorIfNeeded()`
- `stopKeyboardMonitor()`
- `startMouseMonitorIfNeeded()`
- `stopMouseMonitor()`
- 键盘滚动相关方法（`scrollCurrentDetailToTop/Bottom`）
- 焦点辅助方法（`handleTabKeyNavigation`、`focusFirstResponderInMasterColumn`）

**优点**：
- 复杂的 AppKit 集成逻辑集中
- 便于测试和维护
- 焦点管理逻辑统一

---

### 2.3 Detail Column → `MainListView+DetailViews.swift`

**内容**：
- `detailColumn`
- `appleBooksDetailView`
- `goodLinksDetailView`
- `weReadDetailView`
- `dedaoDetailView`
- `wechatChatDetailView`
- `hasSingleSelectionForCurrentSource()`

**优点**：
- 职责明确（详情视图构建）
- 添加新数据源时需要修改

---

### 2.4 Sync & Refresh → `MainListView+SyncRefresh.swift`

**内容**：
- `handleSyncAllInCurrent()`
- `handleRefreshRequest()`
- `performRefresh(for:)`
- `shouldShowSyncProgressAlert(for:)`
- `syncAll(for:)`

**优点**：
- 同步业务逻辑集中
- 便于添加新数据源的同步支持

---

## 三、实现顺序

### Phase 1：Filter Menus（最简单，验证拆分模式）
1. 创建 `MainListView+FilterMenus.swift`
2. 移动 5 个 FilterMenu 计算属性
3. 验证构建通过

### Phase 2：Detail Views
1. 创建 `MainListView+DetailViews.swift`
2. 移动 detailColumn 和各数据源 DetailView
3. 验证构建通过

### Phase 3：Sync & Refresh
1. 创建 `MainListView+SyncRefresh.swift`
2. 移动同步和刷新相关方法
3. 验证构建通过

### Phase 4：Keyboard Monitor
1. 创建 `MainListView+KeyboardMonitor.swift`
2. 移动键盘和鼠标事件监听相关方法
3. 移动焦点辅助方法
4. 验证构建通过

---

## 四、预期结果

### 拆分后文件结构

```
SyncNos/Views/
├── MainListView.swift              (~400 行，核心结构)
├── MainListView+FilterMenus.swift  (~220 行，筛选菜单)
├── MainListView+DetailViews.swift  (~160 行，详情视图)
├── MainListView+SyncRefresh.swift  (~120 行，同步刷新)
└── MainListView+KeyboardMonitor.swift (~300 行，键盘焦点)
```

### 主文件保留内容

- State Objects 声明
- Initialization
- Computed Properties
- Body（主视图结构）
- Main Content（masterColumn、alerts）
- Master Column
- Toolbar Menu 入口

---

## 五、注意事项

1. **使用 `extension`**：所有拆分文件使用 Swift extension，无需传递 self
2. **保持 `private`**：拆分后的方法仍保持 `private` 修饰符
3. **文件命名**：使用 `MainListView+模块名.swift` 格式
4. **构建验证**：每次拆分后验证构建通过

---

## 六、版本历史

| 版本 | 日期 | 修改内容 |
|------|------|----------|
| 1.0 | 2025-12-25 | 初始版本 |

