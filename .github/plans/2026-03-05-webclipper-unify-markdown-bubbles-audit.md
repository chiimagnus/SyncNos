# Audit Report: WebClipper Popup/App 统一 Markdown 渲染与气泡样式

- Repo root: `SyncNos/`
- Plan: `.github/plans/2026-03-05-webclipper-unify-markdown-bubbles-implementation-plan.md`
- Auditor: `plan-task-auditor`
- Scope: 仅审计并对齐计划中的 Task 1-6（消息气泡 + Markdown 渲染一致性），不扩大到全量 CSS 迁移。

## TODO Board (N=6)

1. Task 1: 冻结现状与对齐口径（只读确认）
2. Task 2: 新增共享组件：`ChatMessageBubble`（Tailwind-only）
3. Task 3: App 路由接入共享组件并移除 `.wcMarkdown` 依赖
4. Task 4: Popup 预览接入共享组件并移除 `.chatPreviewMsgMarkdown` 依赖
5. Task 5: 补一个最小测试锁定链接行为（防止回归）
6. Task 6: 端到端验证（构建 + 人工 UI）

## Task-to-File Map

- Task 1:
  - `Extensions/WebClipper/src/ui/shared/markdown.ts`
  - `Extensions/WebClipper/src/ui/app/routes/Conversations.tsx`
  - `Extensions/WebClipper/entrypoints/popup/tabs/ChatsTab.tsx`
  - `Extensions/WebClipper/entrypoints/app/style.css`
  - `Extensions/WebClipper/src/ui/styles/popup.css`
- Task 2:
  - `Extensions/WebClipper/src/ui/shared/ChatMessageBubble.tsx`
  - `Extensions/WebClipper/src/ui/shared/markdown.ts`
- Task 3:
  - `Extensions/WebClipper/src/ui/app/routes/Conversations.tsx`
  - `Extensions/WebClipper/entrypoints/app/style.css`
- Task 4:
  - `Extensions/WebClipper/entrypoints/popup/tabs/ChatsTab.tsx`
  - `Extensions/WebClipper/src/ui/styles/popup.css`
- Task 5:
  - `Extensions/WebClipper/src/ui/shared/markdown.test.ts`
- Task 6:
  - 验证命令：`npm run build`, `npm run check`,（人工）`npm run dev`

## Findings (Open First)

### Finding F-01

- Task: `Task 2: 新增共享组件：ChatMessageBubble（Tailwind-only）`
- Severity: `Medium`
- Status: `Resolved`
- Location: `Extensions/WebClipper/src/ui/shared/ChatMessageBubble.tsx:26`
- Summary: `ChatMessageBubble` 为每个 bubble 实例各自创建一份 `markdown-it` renderer（`useMemo` 绑定到组件实例），列表渲染时会产生 N 份 renderer。
- Risk: 性能与内存回退（与之前 app/popup 各自只创建 1 份 renderer 相比）；也增加未来行为漂移的机会（renderer 配置变更需要保证每个实例一致）。
- Expected fix: 将 renderer 提升为模块级单例（或以 shared hook/单例函数提供），bubble 内仅负责 `md.render()`，避免每条消息重复 new renderer。
- Validation:
  - `cd Extensions/WebClipper && npm run compile`
  - `cd Extensions/WebClipper && npm test`
  - `cd Extensions/WebClipper && npm run build`
- Resolution evidence: commit `a021b1f7` + compile/test/build 通过（见下方 Fix/Validation log）。

## Fix Log

- Resolved F-01:
  - Change: 提升 renderer 为模块级单例（避免每条消息重复创建 renderer）
  - Commit: `a021b1f7`

## Validation Log

- `cd Extensions/WebClipper && npm run compile` PASS
- `cd Extensions/WebClipper && npm test` PASS
- `cd Extensions/WebClipper && npm run build` PASS
- `cd Extensions/WebClipper && npm run check` PASS
- Manual UI: 未在本环境实际打开浏览器验证（需要人手在扩展 popup 与 app 路由点开对比）。

## Current Status / Residual Risk

- 计划验收点（openLinksInNewTab、新气泡样式、去除旧 markdown CSS 块）已实现并通过自动化构建与测试。
- Residual: 无阻断项（仍建议补一轮人工 UI 对比确认“完全一致”的视觉细节）。
