# Browser-required boundaries

Read this only when the CLI cannot complete the task by itself and live browser context is required. Use the existing browser Skill, then return to the CLI for state read-back.

## Local CLI Integration permission

When registration is healthy but `doctor` still reports `extension_unreachable`, use a user gesture in the target browser/Profile at SyncNos **Settings → General → Local CLI Integration** to enable permission, then run `syncnos status` / `syncnos doctor`. Do not edit Profile, Preferences, Secure Preferences, or private storage to bypass the `nativeMessaging` user gesture.

## Live page context

- Selection comments: select the exact text on the real HTTP(S) article page and create the root comment through SyncNos's existing in-page comments flow. Do not construct locator JSON manually. Read back with `comments list` if needed.
- `capture`: if the target page is not the active tab, only activate the correct tab and then run `syncnos capture`; do not duplicate collector DOM logic.
- `$` mention: use `mention search` / `mention build` to produce the candidate and insertion text. Use browser automation only when the user actually asked to insert it into a webpage composer; do not copy site editor logic into the Skill.

## OAuth / Device Flow

Start authentication from the CLI; the browser handles only required user approval. After Notion/Feishu approval, return to `auth status`. For GitHub, it is safe to show the CLI-returned `verificationUri` and `userCode`; after approval continue with `poll` / status. Do not read or expose access/refresh tokens, client secrets, API keys, or the internal `deviceCode`.
