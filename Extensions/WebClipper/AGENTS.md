# SyncNos WebClipper (Chrome Extension) Agent Guide

WebClipper is a standalone Chrome extension (MV3) in this repository. It captures AI chat conversations from supported sites into a local browser database, then lets users export (JSON/Markdown) or manually sync to Notion.

## Scope

- Target: `Extensions/WebClipper/`
- Platforms: Chrome / Chromium (load unpacked for development)
- Supported sites (content scripts): ChatGPT, Claude, Gemini, DeepSeek, Kimi, Doubao, Yuanbao, NotionAI
- Data: stored locally (IndexedDB + `chrome.storage.local`); network calls are mainly Notion OAuth + Notion API during manual sync

## Key Constraints

- Keep changes focused on: capture -> local persistence -> export -> manual Notion sync.
- Keep permissions minimal and explicit; avoid adding `*://*/*` or unrelated Chrome APIs.
- Do not log or persist secrets beyond `chrome.storage.local` (Notion OAuth client secret is user-provided).
- Prefer local-first UX: auto-capture saves locally; Notion sync is user-triggered and may overwrite the target page content.

## Architecture (High Level)

- Content script (`src/bootstrap/content.js`): picks an active collector, observes DOM changes, computes incremental snapshots, upserts to background, and provides an in-page “Save” button.
- Collectors (`src/collectors/*-collector.js`): per-platform extractors that output a normalized `{ conversation, messages }` snapshot.
- Background service worker (`src/bootstrap/background.js`): IndexedDB CRUD, sync mappings, Notion OAuth callback handling (via `webNavigation`), and batch Notion sync.
- Popup UI (`src/ui/popup/*`): chat list selection, export menu (JSON/Markdown), Settings tab for Notion connect + parent page selection.
- Notion sync (`src/sync/notion/*`): create/reuse per-source databases, create/update pages, clear children + append blocks.

## Commands

- Install deps: `npm --prefix Extensions/WebClipper install`
- Static check (manifest/icons + JS syntax): `npm --prefix Extensions/WebClipper run check`
- Unit tests (Vitest): `npm --prefix Extensions/WebClipper run test`
- Build package: `npm --prefix Extensions/WebClipper run build`

## Local Load (Developer Mode)

- Open `chrome://extensions`
- Enable Developer mode
- Load unpacked: `Extensions/WebClipper/`

## References

- Business map: `.github/docs/business-logic.md`
- Entry points: `Extensions/WebClipper/manifest.json`, `Extensions/WebClipper/src/bootstrap/content.js`, `Extensions/WebClipper/src/bootstrap/background.js`
