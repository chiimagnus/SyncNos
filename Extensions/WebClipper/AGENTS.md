# WebClipper (Chrome Extension) Agent Guide

WebClipper is a standalone Chrome extension (MV3) in this repository. It captures AI chat conversations from supported sites into a local browser database and allows users to export or manually sync to Notion.

## Scope

- Target: `Extensions/WebClipper/`
- Platforms: Chrome / Chromium browsers (developer mode local load first)
- Data: stored locally (IndexedDB + `chrome.storage.local`), exported as JSON/Markdown, and sent to Notion only on manual sync

## Key Constraints

- Keep changes focused on: capture -> local storage -> export -> manual Notion sync.
- Avoid introducing broad permissions by default; prefer optional permissions for on-demand features.
- Do not hardcode absolute file paths in docs or logs.

## Architecture (High Level)

- Content scripts: observe DOM changes, extract snapshots, send to background for persistence.
- Background service worker: IndexedDB CRUD, export orchestration, Notion OAuth/token handling, Notion API calls, batch sync.
- Collectors: per-platform extractors that output a normalized `{ conversation, messages }` snapshot.

## Commands

- Install deps: `npm --prefix Extensions/WebClipper install`
- Static check: `npm --prefix Extensions/WebClipper run check`
- Unit tests: `npm --prefix Extensions/WebClipper run test`
- Build package: `npm --prefix Extensions/WebClipper run build`

## Local Load (Developer Mode)

- Open `chrome://extensions`
- Enable Developer mode
- Load unpacked: `Extensions/WebClipper/`

## References

- MVP requirements: `.github/docs/Chrome插件-ChatGPT-NotionAI-MVP-需求汇总.md`
- Implementation plan: `.github/plans/2026-02-12-webclipper-implementation-plan.md`

