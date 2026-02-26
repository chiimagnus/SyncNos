# Audit Report: WebClipper Popup 广播+订阅（Port）替代轮询

Plan: `.github/plans/2026-02-26-webclipper-broadcast-subscribe-implementation-plan.md`

Repo root: `/Users/chii_magnus/Github_OpenSource/SyncNos`

## TODO board（7 tasks）

- [x] Task 1: 定义事件协议常量
- [x] Task 2: Background 事件 Hub + onConnect 注册
- [x] Task 3: 会话变更点广播（sync/delete/article fetch）
- [x] Task 3.5: popup-database 导入后刷新列表
- [x] Task 4: popup 建立 Port 订阅并 debounce 刷新
- [x] Task 5: 移除 2s 轮询刷新
- [x] Task 6: 单测覆盖广播触发

## Task-to-file map

- Task 1
  - `Extensions/WebClipper/src/protocols/message-contracts.js`
- Task 2
  - `Extensions/WebClipper/src/bootstrap/background-events-hub.js`
  - `Extensions/WebClipper/src/bootstrap/background.js`
  - `Extensions/WebClipper/src/bootstrap/background-router.js`
- Task 3
  - `Extensions/WebClipper/src/bootstrap/background-router.js`
- Task 3.5
  - `Extensions/WebClipper/src/ui/popup/popup-database.js`
- Task 4
  - `Extensions/WebClipper/src/ui/popup/popup.js`
- Task 5
  - `Extensions/WebClipper/src/ui/popup/popup.js`
- Task 6
  - `Extensions/WebClipper/tests/smoke/background-router-conversations-events.test.ts`

## Findings（Open first）

## Finding F-01

- Task: `Task 4: popup 建立 Port 订阅并 debounce 刷新`
- Severity: `Medium`
- Status: `Resolved`
- Location: `Extensions/WebClipper/src/ui/popup/popup.js:41`
- Summary: `scheduleConversationsRefresh` 在 refresh 进行中收到新事件时，可能“丢刷新”导致列表错过最新变更。
- Risk: 高并发/连续保存时，popup 可能停留在旧列表直到下次事件（或用户手动操作/重开）。
- Expected fix: 增加 pending 标记（例如 `conversationsRefreshPending`），若事件发生在 refresh 进行中，则在当前 refresh 结束后再补一次 refresh（合并多次事件）。
- Validation: `npm --prefix Extensions/WebClipper test`
- Resolution evidence: `fix: audit1 - avoid dropping popup refresh events` (commit `5e179df5`), `npm --prefix Extensions/WebClipper test` PASS

## Finding F-02

- Task: `Task 4: popup 建立 Port 订阅并 debounce 刷新`
- Severity: `Low`
- Status: `Resolved`
- Location: `Extensions/WebClipper/src/ui/popup/popup.js:1`
- Summary: `popup.js` 使用 `chrome.runtime.connect` 但未声明 `/* global chrome */`，与项目其它 popup 文件的风格不一致。
- Risk: 若后续增加静态检查/规则，可能产生不必要的告警；同时降低一致性与可读性。
- Expected fix: 在文件头部增加 `/* global chrome */`。
- Validation: `npm --prefix Extensions/WebClipper test`（以及如有 `npm --prefix Extensions/WebClipper run check` 更佳）
- Resolution evidence: `fix: audit1 - avoid dropping popup refresh events` (commit `5e179df5`), `npm --prefix Extensions/WebClipper test` PASS

## Fix log

- `5e179df5` 修复 popup refresh 合并逻辑，避免 refresh 进行中丢事件；并补齐 `/* global chrome */` 声明。

## Validation log

- `npm --prefix Extensions/WebClipper test` → PASS

## Final status and residual risks

- 当前实现满足“广播+订阅替代轮询”的主目标；已修复连续事件下的刷新丢失风险。
