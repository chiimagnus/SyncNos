---
name: syncnos
description: "Use `syncnos` CLI to interact with the SyncNos browser extension: capture, query, and manage content; work with comments and settings; sync providers; open, export, and back up data."
---

# SyncNos

Use `syncnos` as the normal operational entry point. The Extension/IndexedDB remains the business source of truth; do not read or write IndexedDB, runtime messages, browser profiles, or private storage instead of using the CLI.

## Workflow

1. When command syntax or capability boundaries are uncertain, run `syncnos --help` / `syncnos capabilities`. Treat current CLI output as authoritative instead of maintaining a command copy in this Skill.
2. For install, uninstall, `doctor`, or `native_host_*` / `browser_not_found` / `package_invalid` failures, read `references/installation.md`.
3. When the task needs a webpage selection, OAuth user approval, a Local CLI Integration permission gesture, or the real active tab/composer, read `references/browser-required.md` and use the existing browser Skill.
4. Treat CLI JSON, stable error codes, and the final business state as authoritative. If a mutation outcome is uncertain, read back through the CLI before retrying.

## Runtime boundaries

- Normal business commands require at least one online browser instance with Local CLI Integration enabled; `install` / `uninstall` / `doctor` do not require an online instance.
- Instance selection order is explicit `--instance` > online preferred instance > only online instance > `instance_ambiguous`. On ambiguity, inspect `syncnos instances`; do not guess by recency. Set a default only when the user wants a persistent default.
- On `extension_unreachable`, run `doctor` first. Its candidate reasons are hypotheses, not confirmed causes.

## Key operations

- `capture` acts on the current active page. If another target page must be captured, use browser automation only to activate that tab; do not reimplement collector logic.
- Root/reply/delete comments use the CLI. CLI-created root comments and replies are authored as `<About You name>' CLI`, or `CLI` when no name is configured; there is no caller-supplied author override. Selection-anchored comments follow the browser-required flow; never fabricate a locator.
- Run `settings schema` before changing settings and only operate on public keys.
- Provider auth/config must use CLI-exposed interfaces; do not read underlying credentials directly.
- When the user asks to sync and confirm completion, keep the default wait semantics. Use `--no-wait` only when asynchronous behavior is explicitly needed. `sync_wait_timeout` does not mean the remote job was cancelled.
- `open` resolves a target by default; add `--launch` only when the user asked to actually open it.
