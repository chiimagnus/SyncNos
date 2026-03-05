# Audit Report: WebClipper Popup/App Unify Chats/Settings (2026-03-05)

Plan: `.github/plans/2026-03-05-webclipper-unify-markdown-bubbles-implementation-plan.md`

Repo: `SyncNos/Extensions/WebClipper`

## TODO Board (5 Tasks)

1. Task 7: `useIsNarrowScreen`
2. Task 8: Conversations scene + iOS push + popup reuse
3. Task 9: Settings scene + iOS push + popup reuse
4. Task 10: Popup shell restyle + remove `src/ui/styles/popup.css`
5. Task 11: Manual UI acceptance (`npm run dev`)

## Task-to-File Map

- Task 7
- `Extensions/WebClipper/src/ui/shared/hooks/useIsNarrowScreen.ts`

- Task 8
- `Extensions/WebClipper/src/ui/conversations/conversations-context.tsx`
- `Extensions/WebClipper/src/ui/conversations/ConversationsScene.tsx`
- `Extensions/WebClipper/src/ui/conversations/ConversationListPane.tsx`
- `Extensions/WebClipper/src/ui/conversations/ConversationDetailPane.tsx`
- `Extensions/WebClipper/src/ui/app/AppShell.tsx`
- `Extensions/WebClipper/src/ui/app/conversations/CapturedListSidebar.tsx`
- `Extensions/WebClipper/src/ui/app/routes/Conversations.tsx`
- `Extensions/WebClipper/entrypoints/popup/tabs/ChatsTab.tsx`

- Task 9
- `Extensions/WebClipper/src/ui/settings/SettingsScene.tsx`
- `Extensions/WebClipper/src/ui/app/routes/Settings.tsx`
- `Extensions/WebClipper/src/ui/app/AppShell.tsx`
- `Extensions/WebClipper/entrypoints/popup/tabs/SettingsTab.tsx`
- `Extensions/WebClipper/src/ui/app/routes/settings/types.ts`
- `Extensions/WebClipper/src/ui/app/routes/settings/sections/BackupSection.tsx`
- `Extensions/WebClipper/src/ui/app/routes/settings/sections/ArticleFetchSection.tsx`

- Task 10
- `Extensions/WebClipper/entrypoints/popup/App.tsx`
- `Extensions/WebClipper/entrypoints/popup/style.css`
- `Extensions/WebClipper/entrypoints/popup/tabs/AboutTab.tsx`
- `Extensions/WebClipper/src/ui/styles/tokens.css`
- (deleted) `Extensions/WebClipper/src/ui/styles/popup.css`

- Task 11
- Manual: `cd Extensions/WebClipper && npm run dev`

## Findings (Open First)

## Finding F-01

- Task: `Task 8: Conversations（Chats）抽成共享 Scene（含 iOS push）`
- Severity: `Medium`
- Status: `Resolved`
- Location: `Extensions/WebClipper/src/ui/app/conversations/CapturedListSidebar.tsx:1`
- Summary: App route sidebar bottom action dock not visible due to nested scroll containers (outer sidebar scroll + inner `ConversationListPane` scroll with `sticky bottom`).
- Risk: Sidebar selection/actions become inaccessible; user-perceived regression in app Chats wide layout.
- Expected fix: Make the sidebar use a single scroll container (remove the outer overflow wrapper and keep header outside), so `ConversationListPane`'s sticky bottom dock can render at the actual sidebar bottom.
- Validation:
  - `cd Extensions/WebClipper && npm run compile`
  - `cd Extensions/WebClipper && npm test`
  - Manual: app wide layout verify sidebar bottom dock is visible.
- Resolution evidence: commit `745dec3d` (remove nested scroll wrapper; keep header above `ConversationListPane`), `npm run compile` pass, `npm test` pass.

## Fix Log

- `745dec3d` fix(webclipper-ui): restore sidebar bottom dock in app chats

## Validation Log

- Task 7: `npm run compile` (pass)
- Task 8: `npm run compile` (pass), `npm test` (pass)
- Task 9: `npm run compile` (pass), `npm test` (pass)
- Task 10: `npm run compile` (pass), `npm run build` (pass), `npm run check` (pass)
- Task 11: `npm run dev` started successfully (manual interaction pending)

## Final Status / Residual Risks

- No open findings. Residual risk: manual UI checks (Task 11) still require human verification of narrow/wide interactions.
