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

## B3 · 插件 UI 与宣传图的差异

| **维度** | **宣传图** | **插件 UI** |
| --- | --- | --- |
| **留白** | 大面积留白，呼吸感优先 | 信息密度更高，行间距和内边距更紧凑 |
| **渐变** | 背景微渐变提升质感 | 纯色即可，渐变在小面板上感知不到 |
| **交互状态** | 无 | 需要 hover / active / disabled / focus 状态 |
| **无障碍** | 装饰文字可稍放松 | 所有功能文字必须过 WCAG AA（4.5:1） |
| **主题切换** | 亮暗各出一版截图 | 跟随系统 `prefers-color-scheme` 自动切换 |

## B4 · 暗色模式工程注意事项

1. **阴影换微光** — 亮色模式 `box-shadow` 做投影，暗色模式改用极细亮边（1px `rgba(255,255,255,0.06)`）
2. **层级靠 Surface 梯度** — `bg-sunken`（#141618）→ `bg-primary`（#1A1C20）→ `bg-card`（#262830），逐级提亮
3. **语义色用暗色版** — `--error` 在暗色下自动切为 `#FC8181`，不要硬编码亮色值
4. **跟随系统** — 使用 `prefers-color-scheme: dark` 媒体查询自动切换，不要手动 toggle（除非后续加用户偏好设置）
5. **On-Color 一致性** — 按钮文字永远用 `var(--accent-foreground)` 而不是硬编码黑/白，确保主题切换时自动适配
