# Plan P3 - webclipper-insight-settings

**Goal:** 完成 Insight 的图表化展示、布局打磨与交付前验证，使其达到可上线的设置页体验。

**Non-goals:**
- 本 phase 不做自动刷新、时间热力图或连续天数
- 本 phase 不接入 LLM、云同步或任何远端统计
- 本 phase 不扩展到 popup 当前页或对话列表页

**Approach:**
在文本骨架已经可用的基础上，引入 `recharts` 负责 AI 平台分布和文章域名分布的横向条形图。保持数据仍由本地 `insight-stats.ts` 提供，图表层只关心展示。最后做一次窄宽屏布局打磨与 compile/test/build 全链路验证，确保 SettingsScene 中的新 section 不影响现有 Notion / Obsidian / Backup / Inpage 行为。

**Acceptance:**
- Recharts 成功集成到 WebClipper 构建链路
- AI Conversations 与 Web Articles 的来源分布以图表形式呈现
- Insight 面板在 app settings 宽布局下为双列，在窄布局下自然堆叠
- `compile`、`test`、`build` 都能通过

---

## P3-T1

**Task:** 引入 Recharts 并实现来源分布图

**Files:**
- Modify: `webclipper/package.json`
- Modify: `webclipper/package-lock.json`
- Modify: `webclipper/src/ui/settings/sections/InsightPanel.tsx`

**Step 1: 实现功能**

把 `recharts` 加入 WebClipper 依赖，并在 `InsightPanel.tsx` 中将 AI 平台分布、网页域名分布替换为响应式横向条形图。图表层要直接消费已经折叠好的 top N + other 数据，不在组件里重复做业务聚合；零数据时保持现有空态文案，不渲染空图。

**Step 2: 验证**

Run: `npm --prefix webclipper install && npm --prefix webclipper run compile`

Expected: 新依赖安装成功，TypeScript 能识别 Recharts 组件，InsightPanel 编译通过。

**Step 3: 原子提交**

Run: `git add webclipper/package.json webclipper/package-lock.json webclipper/src/ui/settings/sections/InsightPanel.tsx`

Run: `git commit -m "feat: task7 - 为Insight接入来源分布图"`

---

## P3-T2

**Task:** 完成布局打磨与全链路验证

**Files:**
- Modify: `webclipper/src/ui/settings/sections/InsightPanel.tsx`
- Modify: `webclipper/src/ui/settings/sections/InsightSection.tsx`
- Modify: `webclipper/src/ui/settings/SettingsScene.tsx`

**Step 1: 实现功能**

统一梳理 Insight 卡片间距、标题层级、双列/单列断点与 chart 容器高度，确保 overview 条、AI 区块、文章区块在 Settings app 页面中视觉均衡。补一次人工冒烟说明：空库、已有 chat/article 数据、无效 URL 数据都要检查；同时确认从其它 settings section 切到 Insight 才会触发首次读取，切回后不重复刷新。

**Step 2: 验证**

Run: `npm --prefix webclipper run test && npm --prefix webclipper run build`

Expected: 单测与构建全部通过，SettingsScene 新增 Insight 后不影响现有功能入口。

**Step 3: 原子提交**

Run: `git add webclipper/src/ui/settings/sections/InsightPanel.tsx webclipper/src/ui/settings/sections/InsightSection.tsx webclipper/src/ui/settings/SettingsScene.tsx`

Run: `git commit -m "feat: task8 - 完成Insight布局打磨与验证"`

---

## Phase Audit

- Audit file: `audit-p3.md`
- Rule: 完成本 phase 全部 tasks 后，`executing-plans` 必须自动进入该文件的审计闭环
- Flow:
  1. 先记录发现
  2. 再修复问题
  3. 再运行本 phase 验证命令
