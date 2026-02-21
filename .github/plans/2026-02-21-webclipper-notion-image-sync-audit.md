# Audit Report - WebClipper Notion 图片同步（P1 外链 / P2 转存）

- Plan: `.github/plans/2026-02-21-webclipper-notion-image-sync-implementation-plan.md`
- Repo root: `/Users/chii_magnus/Github_OpenSource/SyncNos`
- Scope: `Extensions/WebClipper/`（采集、popup 预览、Notion 同步与 file_upload）

## TODO board (8 tasks)

1. Task 1: collector-utils 增加图片 URL 抽取与 markdown 追加
2. Task 2: 所有 collector 采集图片并写入 contentMarkdown
3. Task 3: popup 预览渲染图片 + 显示 URL
4. Task 4: Notion 同步端支持 Markdown 图片语法 → external image block
5. Task 5: 手动回归（P1）
6. Task 6: WebClipper 增加 Notion File Upload API 封装
7. Task 7: 写入前把 external image URL 升级为 file_upload image block（失败降级）
8. Task 8: 手动回归（P2）

## Task-to-file map

- Task 1:
  - `Extensions/WebClipper/src/collectors/collector-utils.js`
  - `Extensions/WebClipper/tests/smoke/collector-utils-images.test.ts`
- Task 2:
  - `Extensions/WebClipper/src/collectors/chatgpt-collector.js`
  - `Extensions/WebClipper/src/collectors/claude-collector.js`
  - `Extensions/WebClipper/src/collectors/gemini-collector.js`
  - `Extensions/WebClipper/src/collectors/deepseek-collector.js`
  - `Extensions/WebClipper/src/collectors/kimi-collector.js`
  - `Extensions/WebClipper/src/collectors/doubao-collector.js`
  - `Extensions/WebClipper/src/collectors/yuanbao-collector.js`
  - `Extensions/WebClipper/src/collectors/zai/zai-collector.js`
  - `Extensions/WebClipper/src/collectors/notionai/notionai-collector.js`
  - `Extensions/WebClipper/tests/smoke/collectors-images-smoke.test.ts`
- Task 3:
  - `Extensions/WebClipper/src/ui/popup/popup-chat-preview.js`
  - `Extensions/WebClipper/src/ui/styles/popup.css`
- Task 4:
  - `Extensions/WebClipper/src/sync/notion/notion-sync-service.js`
  - `Extensions/WebClipper/tests/smoke/notion-sync-service-markdown.test.ts`
- Task 6:
  - `Extensions/WebClipper/src/sync/notion/notion-api.js`
  - `Extensions/WebClipper/src/sync/notion/notion-files-api.js`
  - `Extensions/WebClipper/src/bootstrap/background.js`
  - `Extensions/WebClipper/tests/smoke/notion-files-api.test.ts`
- Task 7:
  - `Extensions/WebClipper/src/bootstrap/background-router.js`
  - `Extensions/WebClipper/src/sync/notion/notion-sync-service.js`
  - `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

## Findings (Open first)

## Finding F-01

- Task: `Task 2: 所有 collector 采集图片并写入 contentMarkdown`
- Severity: `High`
- Status: `Resolved`
- Location: `Extensions/WebClipper/src/collectors/kimi-collector.js:1`
- Summary: 多个 collector 用 message wrapper 作为图片扫描范围，可能把头像/按钮图标等“非消息内容图片”误认为消息图片并同步到 Notion。
- Risk: Notion 页面出现无关图片（头像、UI icon），污染聊天内容；且会触发 P2 file_uploads 额外请求与速率限制风险。
- Expected fix: 将图片抽取范围收敛到“消息正文容器节点”（用于提取文本/markdown 的节点集合），仅在必要时才 fallback 扫描 wrapper。
- Validation: `npm --prefix Extensions/WebClipper run test`
- Resolution evidence: Resolved in `fix: audit - scope image extraction` (`5c77fca7`).

## Finding F-02

- Task: `Task 6: WebClipper 增加 Notion File Upload API 封装`
- Severity: `Low`
- Status: `Resolved`
- Location: `Extensions/WebClipper/src/sync/notion/notion-files-api.js:1`
- Summary: `waitUntilUploaded()` 对 `failed` 状态的错误信息缺少上下文（无法区分是 403/签名过期/Notion 导入失败等）。
- Risk: 线上排障困难；但已具备 external fallback，不会阻断主流程。
- Expected fix: 在 `failed/unknown` 分支里尽可能附带 `status`/`file_import_result`（如存在）或原始响应片段。
- Validation: `npm --prefix Extensions/WebClipper run test`
- Resolution evidence: Resolved in `fix: audit - improve file upload errors` (`f69ed944`).

## Fix log

- `5c77fca7` fix: audit - scope image extraction
- `f69ed944` fix: audit - improve file upload errors

## Validation log

- Run: `npm --prefix Extensions/WebClipper run test` → PASS
- Run: `npm --prefix Extensions/WebClipper run check` → PASS
- Run: `npm --prefix Extensions/WebClipper run build` → PASS

## Final status and residual risks

- All findings resolved.
- Residual risk: popup 预览会加载远程图片（用户需求）；若需要隐私/安全控制，后续可加“仅点击后加载图片”的开关。
