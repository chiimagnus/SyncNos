# WebClipper UI 一致性梳理（Sidebar Header / Detail Header / Sidebar Footer）

> 目标：把当前“按钮样式与布局分叉”的实现点逐一定位出来，并给出可执行的统一方向与改造切分建议。  
> 范围：仅梳理 `Extensions/WebClipper/src/ui/**` 相关 UI；不改动任何 i18n 字段与文案。

## 1. 结论概览（当前不一致的根因）

目前 WebClipper 的 “同一类按钮” 在不同入口（App / Popup / 窄屏）里出现了**3 套并行的按钮系统**：

1) **Nav icon button 系列**（图标按钮）
- 来源：`Extensions/WebClipper/src/ui/shared/nav-styles.ts`
- 代表：`navIconButtonClassName()`、`navIconButtonSmClassName()`
- 使用点：App sidebar 顶部（`CapturedListSidebar.tsx`）、Popup header 右侧设置按钮（`PopupShell.tsx`）、窄屏 detail header 返回按钮（`DetailNavigationHeader.tsx`）

2) **Tint / Danger button 系列**（文本按钮）
- 来源：`Extensions/WebClipper/src/ui/shared/button-styles.ts`
- 代表：`buttonTintClassName()`、`buttonDangerClassName()`
- 使用点：App sidebar 底部 delete/export/sync（`ConversationListPane.tsx`）

3) **Detail header 的“特例按钮”**（在 tint 基础上二次覆写）
- 使用点：宽屏 detail header（`ConversationDetailPane.tsx`）
- 表现：仍用 `buttonTintClassName()` 作为基底，但额外叠加 `tw-bg-white/38 hover:tw-bg-white/55`（与 sidebar footer 的 `--btn-bg` 系列完全不同）

因此：即使逻辑复用（例如 `DetailHeaderActionBar`、`ConversationListPane`）做得不错，**视觉系统仍然在“同名职责”下分裂成多套 class 组合**，这就是你观察到的“不统一”的主要来源。

## 2. 入口与布局：哪里在渲染这些按钮

### 2.1 Extension App（全页面）

- App Shell（整体布局 / 侧边栏开合 / 窄屏 detail header 容器）
  - `Extensions/WebClipper/src/ui/app/AppShell.tsx:173`：渲染 `CapturedListSidebar`
  - `Extensions/WebClipper/src/ui/app/AppShell.tsx:192`：sidebar collapsed 时的“展开按钮”（`navIconButtonClassName(false)`）
  - `Extensions/WebClipper/src/ui/app/AppShell.tsx:208`：窄屏 detail header 使用 `DetailNavigationHeader`

#### App Sidebar 顶部：三个按钮（你指出的点）

- `Extensions/WebClipper/src/ui/app/conversations/CapturedListSidebar.tsx:51`
  - `Settings`：`NavLink` + `navIconButtonClassName(isActive)`
  - `Refresh`：`button` + `navIconButtonClassName(false)`
  - `Collapse`：`button` + `navIconButtonClassName(false)`

这三个按钮是一个“纯 icon button 组”，属于 **Nav icon button 系列**。

#### App Sidebar 底部：delete / export / sync（你指出的点）

- `Extensions/WebClipper/src/ui/conversations/ConversationListPane.tsx:334`
  - `actionButton = buttonTintClassName()`
  - `dangerButton = buttonDangerClassName()`
- `Extensions/WebClipper/src/ui/conversations/ConversationListPane.tsx:442`
  - 底部 sticky action bar（含 selectAll、filter、delete/export/obsidian/notion）

这组按钮是“纯文本 action bar”，属于 **Tint / Danger button 系列**。

### 2.2 Popup（浏览器弹窗）

- Popup Header：在 list 模式下渲染 logo + 右侧 action；在 detail 模式下使用 `DetailNavigationHeader`
  - `Extensions/WebClipper/src/ui/popup/PopupShell.tsx:55`

Popup list 模式右侧按钮：
- 主操作（“当前页抓取”）：`navPillButtonClassName()`（`PopupShell.tsx:83`）
- 设置按钮：`navIconButtonSmClassName(false)`（`PopupShell.tsx:93`）

这里出现了 **Nav pill button**（一套新的按钮外观），并且 icon button 使用的是 `Sm` 版本。

### 2.3 详情页 Header：宽屏 vs 窄屏两套

#### 窄屏 detail header（Popup 与 App 窄屏共用）

- `Extensions/WebClipper/src/ui/conversations/DetailNavigationHeader.tsx:16`
  - Back：`navIconButtonClassName(false)`（icon-only）
  - Actions：`buttonTintClassName()` + `tw-h-8 tw-rounded-lg tw-text-[11px] tw-font-black`（更矮、更小圆角、更重字重）

这套 header 是“导航条式”的：**icon back + compact actions**。

#### 宽屏 detail header（App 宽屏 ConversationDetailPane 自带 header）

- `Extensions/WebClipper/src/ui/conversations/ConversationDetailPane.tsx:37`
  - `outlineButtonClass = buttonTintClassName() + tw-bg-white/38 ...`
- `Extensions/WebClipper/src/ui/conversations/ConversationDetailPane.tsx:43`
  - 头部布局：左侧 back（可选）+ 标题/副标题，右侧 action bars

这里的动作按钮与 sidebar footer 共享“tint 基础”，但背景策略改成了 `white/38`，属于目前的“特例按钮”。

## 3. “不统一”清单（按你点名的 3 个区域）

### 3.1 App Sidebar 顶部三个按钮（Settings / Refresh / Collapse）

现状：
- 全部用 `navIconButtonClassName()`（size=9、rounded-xl、bg=white/25、hover=white/38）
- 三个按钮之间的“语义类型”一致（都是 icon-only），但和其它区域的按钮系统无强约束关系

不一致来源：
- Popup 的设置按钮用的是 `navIconButtonSmClassName()`（size=8、rounded-lg）而非同一规格
- DetailNavigationHeader 的返回按钮用 `navIconButtonClassName()`，但其右侧 action 按钮是另一套（更矮、更小圆角）

### 3.2 Detail View 的 Navigation Header 按钮（Back / Action）

现状：
- 窄屏：`DetailNavigationHeader`（icon back + compact tint actions）
- 宽屏：`ConversationDetailPane`（可选“文字 Back”按钮 + outline 特例 tint actions）

不一致来源：
- “Back”在宽屏是文字按钮（`{t('backButton')}`），窄屏是图标按钮（ChevronLeft）
- Action button 的尺寸（min-height/rounded/text size/font weight）与背景策略（`--btn-bg` vs `white/38`）不一致
- `DetailHeaderActionBar` 的菜单在窄屏 header 中是向下展开（`top: calc(100%+8px)`），但 export menu 在 sidebar footer 是向上展开（`bottom: calc(100%+8px)`）；视觉与交互节奏不一致

### 3.3 App Sidebar 底部 delete / export / sync（选择态 action bar）

现状：
- `ConversationListPane` 底部 sticky bar：主要按钮全是 `buttonTintClassName()` / `buttonDangerClassName()`
- export dropdown 是“按钮 + ▾ + menu”自实现（不是复用 `DetailHeaderActionBar`）

不一致来源：
- 与 detail header 的 action bar（`DetailHeaderActionBar`）存在“同类下拉菜单”却重复实现（菜单定位、触发器 aria、样式）
- 与 App sidebar 顶部 icon button 系列完全不同（尺寸、圆角、背景体系）
- Popup 的 list 顶部主操作是 `navPillButtonClassName()`，但 sidebar footer 主操作仍是 `buttonTintClassName()`（两套“primary button”）

## 4. 可执行的统一方向（建议用“设计 token + 组件”两层收敛）

下面是“最少改动、收益最大”的统一路径，按建议优先级排序。

### 4.1 先统一“按钮 token”（减少自由拼 class）

建议把目前散落的按钮外观收敛成 4 类明确语义：

1) `IconButton`（导航/工具 icon-only）
- 规格：支持 `sm|md` 两档（对应现有 `navIconButtonSmClassName` / `navIconButtonClassName`）
- 统一：圆角体系、背景策略、disabled 行为、focus ring

2) `PrimaryPillButton`（Popup 当前页抓取这种“单个主操作”）
- 直接用 `navPillButtonClassName()` 作为唯一实现
- 明确：只用于 header 右侧主操作，不在 footer action bar 中混用

3) `ActionButton`（列表选择态、detail actions 的文本按钮）
- 以 `buttonTintClassName()` 为基础，但不要在调用点自由叠加 `tw-bg-white/38` 这种“主题特例”
- 若确实需要“outline/ghost”风格，抽成 `buttonGhostClassName()` 或 `buttonHeaderActionClassName()`，而不是在各处拼字符串

4) `DangerActionButton`（删除）
- 继续由 `buttonDangerClassName()` 单一真源提供

### 4.2 再统一“同职责 UI 组件”

1) Sidebar Header Actions（Settings / Refresh / Collapse）
- 抽一个共享组件（例如 `SidebarHeaderActions`）输出：
  - icon buttons 的间距、aria/title、disabled 行为
  - RefreshIcon/CollapseIcon 这类 svg 也统一集中管理
- 好处：App sidebar 顶部三按钮与未来其它 sidebar/header 保持同一实现

2) Detail Header（宽屏 / 窄屏共用底座）
- 当前两套：`ConversationDetailPane`（宽屏 header）+ `DetailNavigationHeader`（窄屏 header）
- 建议：抽一个 `ConversationDetailHeader`（或 `DetailHeaderLayout`）作为公共底座：
  - 左侧：`back` 的呈现策略（icon vs text）由 props 控制，但按钮 token 统一
  - 右侧：统一接入 `DetailHeaderActionBar`，并统一 action button 的 class（不要一处 h-8 rounded-lg，一处 min-h-9 rounded-xl）

3) Dropdown Menu（导出 / open-in / chat-with）
- `ConversationListPane` 的 export dropdown 与 `DetailHeaderActionBar` 是同类组件
- 方向：抽一个“通用 dropdown action button”或让 `DetailHeaderActionBar` 支持“向上展开”与自定义菜单项，以消灭重复实现

## 5. 影响面与验证建议（给后续改造 PR 用）

影响面（后续改造会触及）：
- App：`AppShell.tsx`、`CapturedListSidebar.tsx`、`ConversationDetailPane.tsx`
- Popup：`PopupShell.tsx`、`DetailNavigationHeader.tsx`
- 公共：`nav-styles.ts`、`button-styles.ts`、`DetailHeaderActionBar.tsx`、`ConversationListPane.tsx`

验证建议（按仓库约定顺序）：
- `npm --prefix Extensions/WebClipper run compile`
- `npm --prefix Extensions/WebClipper run test`
- 手工冒烟：
  - App：宽屏（sidebar + detail）/ 窄屏（detail header 顶栏）都走一遍
  - Popup：list 模式 header / detail 模式 header / export dropdown / detail action dropdown

