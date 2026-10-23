---
title: Keyboard shortcuts
description: Configure shortcuts for conversation details, filters, and navigation.
---

Open **SyncNos → Settings → Keyboard shortcuts**.

## In-app shortcuts

You can configure shortcuts for:

- **Navigation:** Settings, toggling the sidebar, and switching to the previous or next conversation.
- **Filters:** Open the source filter, or the domain filter when browsing web sources.
- **Reader:** Play or pause narration when reading article or video content.
- **Conversation details:** Copy the original, Notion, Feishu, or GitHub link; open the original, Notion, Obsidian, Feishu, or GitHub destination; copy full Markdown; export Markdown or JSON; and toggle the comments sidebar.

Buttons such as **More**, Back, Insights, batch-selection actions, and reader layout controls have no separate shortcuts. Detail actions target **the open conversation**, never the multi-selection toolbar. Unavailable actions do not intercept key presses. Previous/Next follows the current list order among loaded conversations; it stops at the first/last loaded entry without wrapping or automatically fetching another page.

1. Search for an action or expand its group.
2. Click the binding button and press your key combination.
3. Resolve conflicts beside the action, use **×** to clear a binding, **Esc** to cancel recording, or **Restore defaults** to reset.

Defaults: **Settings `⌘ + ⇧ + ,`**, **sidebar `⌘ + \\`** on macOS; use Ctrl in place of ⌘ on Windows/Linux. Other actions start unassigned.

Icon tooltips show assigned keys in a subtler second line. The copy destination menu and detail **More** menu show keys on the right of each action. Unassigned keys are hidden. Copy shortcuts provide success feedback.

## Browser shortcuts

Opening the popup, saving the current page, and opening the SyncNos tab remain browser-managed Commands. Use **Manage shortcuts** to reach the browser's shortcut settings. SyncNos does not store or edit browser shortcuts.

## Troubleshooting

In-app shortcuts work only while the SyncNos popup or tab has focus. They do not intercept inputs, editors, or modal dialogs. Confirm the action is available and no shortcut conflict exists. Browser/OS-reserved combinations cannot be overridden.
