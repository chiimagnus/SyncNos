# SyncNos Design System

# Part A · 视觉设计规范

## A1 · 色彩策略

**冷灰底座 + 暖桃点缀。**

整套视觉用带蓝底调的冷灰做底座，干净通透；品牌色 `#FFC6AD`（柔桃色）作为唯一的高优先级强调色，面积控制在 5-10%。冷底上暖色自然跳出，不用堆面积就能抓眼球。

## A2 · 色彩角色

| **角色** | **色值** | **来源** | **用途** |
| --- | --- | --- | --- |
| **Brand Accent** | `#FFC6AD` 柔桃色 | App Logo 猫脸 | CTA 按钮、关键高亮、品牌标识（全局仅一处重点） |
| **Secondary** | `#7BC4A0` 冷薄荷绿 | App Logo 盾牌 | 标签、次要装饰、进度指示 |
| **Tertiary** | `#E8C86A` 哑光金黄 | App Logo 瞳孔 | 极少量：Premium 标识、星标、特殊徽章（可选） |
| **Error** | `#E53E3E` 语义红 | Apple HIG / M3 | 错误提示、删除确认、危险操作（destructive） |
| **Warning** | `#D69E2E` 琥珀黄 | Apple HIG / M3 | 警告提示、即将过期、需要注意 |
| **Success** | `#38A169` 翠绿 | Apple HIG / M3 | 成功反馈、完成状态、已同步 |
| **Info** | `#3182CE` 信息蓝 | Apple HIG / M3 | 信息提示、帮助说明、链接色 |

## A3 · 设计原则

1. **冷色底座** — 背景、文字、边框全部走冷灰（带蓝底调），中性明亮
2. **暖色点缀** — `#FFC6AD` 是唯一的强调色，一张图 / 一个页面最多出现一处
3. **Surface 四级层级** — 不靠颜色数量堆层级，用 sunken → default → raised → overlay 四级 surface 递进（参考 M3 / Atlassian）
4. **无障碍优先** — 所有功能文字对比度过 WCAG AA（4.5:1），非文字元素（图标、边框、focus ring）≥ 3:1（WCAG 1.4.11）
5. **On-Color 必配对** — 每个色彩角色都定义 foreground（在其上方的文字/图标色），确保在任何背景上都可读（参考 M3 on-primary / shadcn foreground 模式）
6. **语义色完整** — Error / Warning / Success / Info 四色齐备，不依赖品牌色传达系统状态（参考 Apple HIG 语义色 + IBM Carbon Support 色组）

## A4 · 亮色模式色板

### Surface & Text

| **Token** | **色值** | **用途** |
| --- | --- | --- |
| **bg-primary** | `#F5F7FA` 冷白 | 页面 / 画布背景（surface-default） |
| **bg-sunken** | `#ECEEF2` 沉底灰 | 嵌套区域、输入框内底（surface-sunken） |
| **bg-card** | `#FFFFFF` 纯白 | 卡片、面板、弹窗（surface-raised） |
| **bg-overlay** | `rgba(0,0,0,0.45)` | 模态遮罩层（surface-overlay） |
| **text-primary** | `#2C3038` 冷深灰 | 正文、标题（带蓝调） |
| **text-secondary** | `#636B78` 冷中灰 | 辅助信息、标注、placeholder（≥ 4.8:1 on bg-primary ✅） |
| **border** | `#D8DCE2` 冷浅灰 | 分割线、装饰线、连接线 |

### 品牌色 + On-Color

| **Token** | **色值** | **用途** |
| --- | --- | --- |
| **accent** | `#FFC6AD` 柔桃色 | CTA 按钮、关键高亮（面积 ≤ 10%） |
| **accent-foreground** | `#2C3038` | accent 上的文字 / 图标（对比度 ≥ 8:1 ✅） |
| **secondary** | `#7BC4A0` 冷薄荷绿 | 标签、次要强调 |
| **secondary-foreground** | `#1A2B22` | secondary 上的文字 / 图标 |
| **tertiary** | `#E8C86A` 哑光金黄 | Premium / 星标（可选） |
| **tertiary-foreground** | `#2C3038` | tertiary 上的文字 / 图标 |

### 语义状态色 + On-Color

| **Token** | **色值** | **Foreground** | **用途** |
| --- | --- | --- | --- |
| **error** | `#E53E3E` | `#FFFFFF` | 错误提示、删除、危险操作 |
| **warning** | `#D69E2E` | `#2C3038` | 警告提示、注意事项 |
| **success** | `#38A169` | `#FFFFFF` | 成功反馈、完成、已同步 |
| **info** | `#3182CE` | `#FFFFFF` | 信息提示、帮助、链接 |

### 焦点与无障碍

| **Token** | **色值** | **用途** |
| --- | --- | --- |
| **focus-ring** | `#FFC6AD` 柔桃（accent） | 键盘焦点环 2px outline + 2px offset（≥ 3:1 on bg-primary & bg-card，符合 WCAG 1.4.11） |

## A5 · 暗色模式色板

暗色模式不是反转亮色——**直接反转会让对比度爆炸，比亮色还冲眼**。核心：冷暗底 + 更柔更低饱和的前景色。

### Surface & Text

| **Token** | **色值** | **说明** |
| --- | --- | --- |
| **bg-primary** | `#1A1C20` 冷炭灰 | 带蓝底调深灰，避免纯黑（surface-default） |
| **bg-sunken** | `#141618` 深沉底 | 嵌套区域、输入框（surface-sunken） |
| **bg-card** | `#262830` 冷浅炭 | 卡片、面板（surface-raised，比 bg-primary 亮一阶） |
| **bg-overlay** | `rgba(0,0,0,0.65)` | 模态遮罩（surface-overlay，暗底需更深遮罩） |
| **text-primary** | `#DCE0E8` 冷柔白 | 蓝底调柔白，避免纯白 `#FFF` |
| **text-secondary** | `#8B919A` 冷浅灰 | 辅助信息（≥ 4.7:1 on bg-primary ✅） |
| **border** | `#363840` 冷暗灰 | 带蓝调的暗边框 |

### 品牌色 + On-Color

| **Token** | **色值** | **说明** |
| --- | --- | --- |
| **accent** | `#FFD4C2` 提亮柔桃 | 暗底上提亮 + 降饱和 15% |
| **accent-foreground** | `#1A1C20` | accent 上的文字 / 图标 |
| **secondary** | `#6AAF8E` 压暗薄荷绿 | 饱和度 -15%，明度 -10% |
| **secondary-foreground** | `#1A1C20` | secondary 上的文字 / 图标 |
| **tertiary** | `#D4B85E` 压暗金黄 | 明度 -10%（可选） |
| **tertiary-foreground** | `#1A1C20` | tertiary 上的文字 / 图标 |

### 语义状态色 + On-Color

暗色模式下语义色需**降饱和 + 提亮**，防止高饱和色在深底上产生荧光感。

| **Token** | **色值** | **Foreground** | **说明** |
| --- | --- | --- | --- |
| **error** | `#FC8181` | `#1A1C20` | 降饱和提亮红 |
| **warning** | `#ECC94B` | `#1A1C20` | 提亮琥珀 |
| **success** | `#68D391` | `#1A1C20` | 降饱和提亮绿 |
| **info** | `#63B3ED` | `#1A1C20` | 降饱和提亮蓝 |

### 焦点与无障碍

| **Token** | **色值** | **说明** |
| --- | --- | --- |
| **focus-ring** | `#FFD4C2` 柔桃（accent） | ≥ 3:1 on bg-primary & bg-card |

## A6 · 暗色模式实操规则

**1. 层级靠 Surface 梯度**

暗色模式下多种颜色混在深色背景上会变成圣诞树。层级主要靠四级 surface：`bg-sunken`（#141618）→ `bg-primary`（#1A1C20）→ `bg-card`（#262830）→ `bg-overlay`，逐级提亮。

**2. 阴影换成微光**

亮色模式用 `box-shadow` 做卡片投影，暗色模式下阴影不可见。改用极细亮边（1px `rgba(255,255,255,0.06)`）或面板背景比底色亮一个灰阶。

**3. 语义色降饱和**

亮色模式的 `#E53E3E`（error）在暗底上会变成刺眼的荧光红。暗色模式统一降饱和 + 提亮（见 A5 语义状态色表）。

**4. 截图要出暗色版**

亮色截图贴在暗底上 = 一坨刺眼的白块，比配色问题还严重。

## A7 · 渐变策略

### ✅ 推荐：大面积背景微渐变

背景从 `#F5F7FA` 渐变到 `#EDF0F5`，肉眼几乎察觉不到，但整张图会比纯色底更有呼吸感和高级感。Apple 官网、Linear、Arc 都在用这招。

- **幅度**：同一色相内，明度差不超过 5-8%
- **暗色模式**：`#1A1C20` → `#22242A`，极微妙的冷色明暗过渡
- **渐变上的文字**：确保在渐变每个 color-stop 点，文字都满足 4.5:1 对比度

### ❌ 避免：多色渐变做强调

橙→绿渐变做标题、彩虹渐变做按钮——这会把好不容易压下去的视觉噪音全拉回来。

**结论：背景微渐变做，品牌色/文字渐变现阶段别碰。**

---

# Part B · WebClipper 插件 UI 工程落地

色板 token 定义见 Part A（A4 亮色 / A5 暗色），本节只讲插件侧的工程实现。

## B0 · UI 分层边界（强约束）

`webclipper/src/ui/**` 只负责 UI（组件/样式/DOM 面板），不承载业务流程与平台交互。

- **UI 允许：**
  - React 组件、样式、布局、交互事件绑定
  - 极薄的 UI glue（将事件/输入转发给 viewmodel）
- **UI 禁止：**
  - 直接 import `webclipper/src/platform/**`（例如 `runtime.send`、`connectPort`、`storageGet/storageSet`、`tabsCreate` 等）
  - 在 UI 文件中做可复用业务逻辑（应下沉到 `src/services/**`）
- **ViewModel 与 Service：**
  - ViewModel 放在 `webclipper/src/viewmodels/**`：只做 UI 状态编排并调用 service
  - Service 放在 `webclipper/src/services/**`：承接业务流程与平台交互

验证命令（手动）：
- `rg -n "src/platform|/platform/" webclipper/src/ui`
- `npm --prefix webclipper run compile`

## B1 · CSS Variables

```css
/* ===== Light Mode ===== */
:root {
  /* Surface */
  --bg-primary: #F5F7FA;
  --bg-sunken: #ECEEF2;
  --bg-card: #FFFFFF;
  --bg-overlay: rgba(0, 0, 0, 0.45);

  /* Text */
  --text-primary: #2C3038;
  --text-secondary: #636B78;

  /* Brand + On-Color */
  --accent: #FFC6AD;
  --accent-foreground: #2C3038;
  --accent-hover: rgba(255, 198, 173, 0.85);
  --accent-active: #F0B89F;
  --secondary: #7BC4A0;
  --secondary-foreground: #1A2B22;
  --tertiary: #E8C86A;
  --tertiary-foreground: #2C3038;

  /* Semantic + On-Color */
  --error: #E53E3E;
  --error-foreground: #FFFFFF;
  --warning: #D69E2E;
  --warning-foreground: #2C3038;
  --success: #38A169;
  --success-foreground: #FFFFFF;
  --info: #3182CE;
  --info-foreground: #FFFFFF;

  /* Utility */
  --border: #D8DCE2;
  --focus-ring: var(--accent);
}

/* ===== Dark Mode ===== */
@media (prefers-color-scheme: dark) {
  :root {
    /* Surface */
    --bg-primary: #1A1C20;
    --bg-sunken: #141618;
    --bg-card: #262830;
    --bg-overlay: rgba(0, 0, 0, 0.65);

    /* Text */
    --text-primary: #DCE0E8;
    --text-secondary: #8B919A;

    /* Brand + On-Color */
    --accent: #FFD4C2;
    --accent-foreground: #1A1C20;
    --accent-hover: rgba(255, 212, 194, 0.85);
    --accent-active: #F0C6B4;
    --secondary: #6AAF8E;
    --secondary-foreground: #1A1C20;
    --tertiary: #D4B85E;
    --tertiary-foreground: #1A1C20;

    /* Semantic + On-Color */
    --error: #FC8181;
    --error-foreground: #1A1C20;
    --warning: #ECC94B;
    --warning-foreground: #1A1C20;
    --success: #68D391;
    --success-foreground: #1A1C20;
    --info: #63B3ED;
    --info-foreground: #1A1C20;

    /* Utility */
    --border: #363840;
    --focus-ring: var(--accent);
  }
}
```

## B2 · 交互状态派生规则

| **状态** | **规则** | **亮色示例** | **暗色示例** |
| --- | --- | --- | --- |
| **hover** | accent + 透明度降 10% | `rgba(255,198,173,0.85)` | `rgba(255,212,194,0.85)` |
| **active** | accent + 明度降 5% | `#F0B89F` | `#F0C6B4` |
| **disabled** | 前景色 38% 透明度（M3 规范） | `rgba(44,48,56,0.38)` | `rgba(220,224,232,0.38)` |
| **focus ring** | focus-ring + 2px outline + 2px offset | `#FFC6AD` | `#FFD4C2` |

### B2.1 · Button Bevel（双 Stroke）

插件内的按钮默认采用“**圆角矩形 + 双 stroke bevel**”的视觉语言：左上角更亮、右下角更暗，形成轻微的立体感；按下（active）时 **stroke 方向反转 + 轻微下压 1px**，让用户感知到“按下去”。

**规范：**

1. **按钮 class 不手写**：优先复用 `webclipper/src/ui/shared/button-styles.ts` 的 `buttonTintClassName()` / `buttonFilledClassName()` / `buttonDanger*ClassName()`。
2. **默认按钮就是 `webclipper-btn`**：`buttonTintClassName()` 返回的就是 `webclipper-btn`（不再存在 `webclipper-btn--tint` 这类分叉）。
3. **按钮真源**：`webclipper/src/ui/styles/buttons.css`（`webclipper-btn` + 少量 modifier；bevel 用两条 inset strokes；`:active` 时反转 + 下压，并包含统一过渡）。
4. **按下态（active）**：把两条 inset 的颜色对调（反转），并 `translateY(1px)`。
5. **主题兼容**：stroke 色值用 `color-mix()` 从当前 surface token（`--bg-card` / `--accent` / `--error`）派生，禁止硬编码亮暗色值。
6. **选中态走 aria**：toggle 用 `aria-pressed='true'`；`SelectMenu` 的选中项用 `aria-checked='true'`（样式在 `buttons.css` 统一处理）。

## B3 · 插件 UI 与宣传图的差异

| **维度** | **宣传图** | **插件 UI** |
| --- | --- | --- |
| **留白** | 大面积留白，呼吸感优先 | 信息密度更高，行间距和内边距更紧凑 |
| **渐变** | 背景微渐变提升质感 | 纯色即可，渐变在小面板上感知不到 |
| **交互状态** | 无 | 需要 hover / active / disabled / focus 状态 |
| **无障碍** | 装饰文字可稍放松 | 所有功能文字必须过 WCAG AA（4.5:1） |
| **主题** | 亮暗各出一版截图 | 仅跟随系统 `prefers-color-scheme`（不提供手动切换） |

## B4 · 暗色模式工程注意事项

1. **阴影换微光** — 亮色模式 `box-shadow` 做投影，暗色模式改用极细亮边（1px `rgba(255,255,255,0.06)`）
2. **层级靠 Surface 梯度** — `bg-sunken`（#141618）→ `bg-primary`（#1A1C20）→ `bg-card`（#262830），逐级提亮
3. **语义色用暗色版** — `--error` 在暗色下自动切为 `#FC8181`，不要硬编码亮色值
4. **系统优先（唯一来源）** — 主题仅由 `prefers-color-scheme` 决定；不要引入 `data-theme` 覆盖或持久化主题开关
5. **On-Color 一致性** — 按钮文字永远用 `var(--accent-foreground)` 而不是硬编码黑/白，确保主题切换时自动适配

### B4.1 · 主题实现边界

- **唯一行为**：主题跟随系统 `prefers-color-scheme`
- **实现真源**：`src/ui/styles/tokens.css`（inpage Shadow DOM 通过 `toHostTokensCss()` 把 `:root` 作用域替换为 `:host`）
- **工程约束**：新增组件按 token 写样式即可；不要引入页面私有的主题状态或额外的 theme switch 逻辑

## B5 · 下拉菜单可视区域策略（SelectMenu）

`SelectMenu` 是 WebClipper 在列表筛选等场景的共享下拉组件。对于位于底部工具条、滚动容器或窄视口中的菜单，统一采用“可视区域自适应”策略，而不是固定高度。

| 场景 | 规则 | 真源 |
| --- | --- | --- |
| 普通下拉 | 可使用固定 `maxHeight` | `src/ui/shared/SelectMenu.tsx` |
| 底部条/受限容器下拉 | 优先启用 `adaptiveMaxHeight`，让组件动态计算 `panelMaxHeight` | `src/ui/conversations/ConversationListPane.tsx` |
| 可视区域计算 | 通过 `findNearestClippingRect()` 找最近 overflow 裁剪容器，再结合 `side` 计算剩余高度；最小值 `80px` | `src/ui/shared/SelectMenu.tsx` |

- 不要把 `source/site` 筛选菜单回退到固定 `maxHeight=320`，这会在某些窗口高度和布局下引入无谓滚动条或菜单裁切。
- 调整菜单样式或布局时，必须同时在 popup 和 app 手工验证：
  - 空间充足时不出现无谓滚动条
  - 空间不足时出现可控滚动且菜单不被裁切

## B6 · 会话详情头动作槽位策略（Detail Header Actions）

会话详情头不再是“单一按钮区”，而是按槽位分发动作。UI 层必须遵守统一槽位协议，避免 popup 与 app 或窄屏 / 宽屏行为分叉。

| 槽位 | 典型动作 | 真源 | UI 约束 |
| --- | --- | --- | --- |
| `open` | Open in Notion / Open in Obsidian | `src/integrations/openin/*`, `src/integrations/detail-header-actions.ts` | 单动作直出，多动作菜单 |
| `chat-with` | Chat with ChatGPT / Claude / ... | `src/integrations/chatwith/chatwith-detail-header-actions.ts` | 先复制 payload，再跳转外链 |
| `tools` | `cache-images`（仅 chat） | `src/ui/conversations/conversations-context.tsx` | article 不显示；触发后应回馈计数并刷新 detail |

- 槽位契约定义在 `src/integrations/detail-header-action-types.ts`，不要在组件内硬编码“动作分组字符串”。
- 主详情页与窄屏 header 必须共享同一分发行为：
  - 主详情：`ConversationDetailPane.tsx`
  - 窄屏 header：`DetailNavigationHeader.tsx`（由 `PopupShell.tsx` / `AppShell.tsx` 承载）
- `DetailHeaderActionBar.tsx` 是统一渲染层：槽位内单动作直出按钮、多个动作折叠菜单；不要在调用方重复实现同一套判定。
- `cache-images` 的动作语义是“本地补全历史图片”，不是“立即重跑整页采集”；UI 文案和反馈应围绕 `updated / downloaded / cache hits`。

最小手工验证（popup + app 都要过）：
- chat detail：`tools / chat-with / open` 槽位均可显示且可点击。
- article detail：不出现 `cache-images`。
- 窄屏模式：header 动作槽位与宽屏详情页一致，无缺槽位或错位分组。
