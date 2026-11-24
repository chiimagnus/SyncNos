# Browser-required boundaries

Read this only when the CLI cannot complete the task by itself and live browser context is required. Use the existing browser Skill, then return to the CLI for state read-back.

## Local CLI Integration permission

When registration is healthy but `doctor` still reports `extension_unreachable`, inspect the target browser/Profile through the browser Skill. Do not ask the user to reconfirm facts they already provided. If Local CLI Integration is not enabled or the `nativeMessaging` permission must be granted again, use the visible SyncNos **Settings → CLI & AI SKILL → Local access → Enable SyncNos CLI** control and its required user gesture, then run `syncnos status` / `syncnos doctor`. Do not edit Profile, Preferences, Secure Preferences, or private storage to bypass the permission gesture.

## Live page context

- Selection comments: select the exact text on the real HTTP(S) article page and create the root comment through SyncNos's existing in-page comments flow. Do not construct locator JSON manually. Read back with `comments list` if needed.
- `capture`: activate the intended tab, then verify the browser-reported active tab URL before running `syncnos capture`. CDP target activation alone is not proof; do not capture if the tab identity is uncertain or reimplement collector DOM logic.
- `$` mention: use `mention search` / `mention build` to produce the candidate and insertion text. Use browser automation only when the user actually asked to insert it into a webpage composer; do not copy site editor logic into the Skill.

## Provider authentication

Start OAuth / Device Flow from the CLI. The browser handles user approval; afterward, read back
`auth status` (and GitHub `poll` when needed). For GitHub, show the CLI-returned
`verificationUri` and `userCode` when approval is needed. Do not read or expose credentials
or the internal `deviceCode`.

Notion's manual connection is a browser-only exception, not a CLI auth action.
If the user chooses it, follow [Notion setup](https://chiimagnus.github.io/SyncNos/docs/en/sync/notion/)
and let them enter the integration token directly in SyncNos settings, never through chat or a
command argument. Do not disconnect an existing account without authorization.
Return to `notion auth status` to verify the connection and use the CLI for destination configuration
and sync. A connected status alone does not prove page access or successful remote writes.
