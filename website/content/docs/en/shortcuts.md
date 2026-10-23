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

Default keys: **Settings `⌘ + ⇧ + ,`** and sidebar `⌘ + \` on macOS (`Ctrl + Shift + ,` and `Ctrl + \` on Windows/Linux). Other in-app actions are unassigned by default. Key labels adapt to the system without left/right modifier distinctions.

There are **17 configurable in-app actions**: nine general, library, and reader actions, plus eight detail actions. The detail actions copy Notion / Feishu / GitHub links, or open the original URL or a Notion / Obsidian / Feishu / GitHub target. A detail shortcut works only when its destination is available for the current conversation. Unassigned actions never consume keys.

Item shortcuts directly perform the action on the current list or detail item, **not the multi-select toolbar**. In two-column mode, keyboard focus determines the target. Unavailable actions do not capture keys; deletion requires confirmation. Bulk export, sync, and delete stay in the multi-select toolbar. The existing detail **More** menu remains; no per-item menus are added.

Insights, Back, domain distribution, and **More** buttons have no in-app shortcuts. Saving the current page is a browser-level shortcut only.

Icon tooltips show assigned shortcuts on a separate, subtler line. The Copy destinations dropdown and the existing detail **More** menu show assigned keys at the right of each action in the same subdued style; unassigned actions show no key hint.

## A shortcut does not work?

- **Browser shortcut**: check that the browser has assigned the key. You cannot edit browser bindings directly in SyncNos.
- **In-app shortcut**: keep focus inside the SyncNos popup or app tab and make sure the action is available. Shortcuts do not interrupt inputs, editors, or modal dialogs.
- **Recording fails**: check the conflict message beside the action and try another combination. Bare **Tab** is reserved for focus navigation and **Esc** cancels recording. Browser/system shortcuts and some hardware keys may be unavailable.
