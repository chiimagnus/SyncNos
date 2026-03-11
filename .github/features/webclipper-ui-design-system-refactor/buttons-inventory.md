# WebClipper 按钮样式盘点（P4-T1）

目标：把“按钮样式从哪里来”说清楚，并定位仍在漂移/重复的内联实现，作为后续统一收敛的输入。

---

## 1) 共享真源（Single source-of-truth）

### A. 常规按钮（Text button）

文件：`webclipper/src/ui/shared/button-styles.ts`

- `buttonTintClassName()`：默认按钮（卡片底 + 边框）
- `buttonFilledClassName()`：主 CTA（accent 填充）
- `buttonDangerClassName()`：危险操作（error 填充）

共同点：
- disabled 统一 `opacity: 0.38`
- focus ring 统一 `outline-2 + offset-2 + --focus-ring`

### B. 导航/图标按钮（Nav + Icon button）

文件：`webclipper/src/ui/shared/nav-styles.ts`

- `navItemClassName(active)`：sidebar item（对齐 `webclipper/src/ui/example.html` 的 hover/active）
- `navIconButtonClassName(active)` / `navIconButtonSmClassName(active)`：方形圆角 icon button（两种尺寸）
- `navPillButtonClassName()`：header pill button（popup 顶部）
- `navMiniIconButtonClassName(disabled)`：mini icon button（当前未被调用）

### C. Settings 封装（复用入口）

文件：`webclipper/src/ui/settings/ui.ts`

- `buttonClassName` → `buttonTintClassName()`
- `primaryButtonClassName` → `buttonFilledClassName()`

---

## 2) 已统一复用（样式一致的按钮调用点）

（典型例子）
- `webclipper/src/ui/settings/sections/*`：多处直接使用 `buttonClassName` / `primaryButtonClassName`
- `webclipper/src/ui/popup/PopupShell.tsx`：`navPillButtonClassName()`、`navIconButtonSmClassName()`
- `webclipper/src/ui/app/conversations/CapturedListSidebar.tsx`：`navIconButtonClassName()`

---

## 3) 仍在漂移的内联按钮样式（需要收敛）

### A. Popover/Menu 的 menu item（重复内联）

现状：同一套 menu item 样式在多处复制粘贴（border/hover/focus/disabled 细节不完全一致）。

- `webclipper/src/ui/conversations/DetailHeaderActionBar.tsx`：`menuButtonClass`
- `webclipper/src/ui/conversations/ConversationListPane.tsx`：Export menu / Sync menu 的 `menuitem` button

### B. 圆形 close / dismiss icon button（重复内联）

- `webclipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx`：dismiss 与 close（同一串 className 复制两次）
- `webclipper/src/ui/app/AppShell.tsx`：Settings sheet 右上角 close（ghost 风格）

### C. ConversationListPane 行内 mini icon button（组件内自建）

- `webclipper/src/ui/conversations/ConversationListPane.tsx`：
  - copy/open 迷你按钮：自己拼 `miniIconBase/miniIconClass/miniIconDisabledClass`

### D. SettingsScene 窄屏返回按钮（内联但可复用）

- `webclipper/src/ui/settings/SettingsScene.tsx`：narrow detail header 的 back button 使用内联 className（可直接替换为 `buttonTintClassName()`）

---

## 4) 为什么会不统一（根因）

- shared helpers 逐步建立后（`button-styles.ts` / `nav-styles.ts`），部分组件仍保留了早期“组件内联 className”的实现；
- menu / close / mini icon 这类“非典型常规按钮”缺少明确的 shared helper，所以在多个组件里出现了相似但不完全一致的写法。

