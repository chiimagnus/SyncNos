---
title: Keyboard shortcuts
description: Configure browser and in-app shortcuts, and troubleshoot keys that do not work.
---

Open **SyncNos → Settings → Keyboard shortcuts**. Browser shortcuts and in-app shortcuts are configured differently.

## Browser shortcuts

Open the popup, save the current page, or open the SyncNos tab. No keys are assigned by default.

The settings page displays the browser's current bindings. Choose **Manage shortcuts** to open the browser's extension shortcut manager. If your browser cannot open it directly, navigate there from the browser settings.

## In-app shortcuts

Control the sidebar, local library, detail actions, reader, and more. These keys work only in the SyncNos popup or app tab.

1. Search for an action or expand its group.
2. Click its key binding, then press the combination you want. Pressed keys appear as you record.
3. The new binding works once saved. If it conflicts with another action, a message appears beside that action so you can try again.

An assigned binding always has a visible **×** button to clear it. Press **Esc** to cancel recording, or **Restore defaults** to reset all in-app shortcuts.

For example, the sidebar defaults to `⌘ + \` on macOS and `Ctrl + \` on Windows/Linux. Key labels follow the operating system, without separate left/right modifiers. **Backspace** and **Delete** can also be assigned.

**Copy full Markdown** has one shortcut. It copies the current library entry in the list, or the open content in the detail pane; in a two-column layout, keyboard focus determines the target.

**Copy original link**, **Export current item**, and **Delete current item** are configurable actions. They operate on the focused library item or open detail, regardless of multi-selection. The export shortcut downloads Markdown; deletion requires confirmation. Each item's **More** menu also provides copying the original link, Markdown/JSON export, sync destinations, and deletion.

**Save current page** uses only the browser-level shortcut. Insights and Back remain available through the interface without in-app shortcuts.

The multi-select toolbar is for bulk deletion, export, and sync, without shortcuts. Reader typography, theme, and narration settings stay in the More menu; play/pause and stop can still have shortcuts.

Hover over icon controls to see active shortcuts on a separate, subtler line below their descriptions.

## A shortcut does not work?

- **Browser shortcut**: check that the browser has assigned the key. You cannot edit browser bindings directly in SyncNos.
- **In-app shortcut**: keep focus inside the SyncNos popup or app tab and make sure the action is available. Shortcuts do not interrupt inputs, editors, or modal dialogs.
- **Recording fails**: check the conflict message beside the action and try another combination. Bare **Tab** is reserved for focus navigation and **Esc** cancels recording. Browser/system shortcuts and some hardware keys may be unavailable.
