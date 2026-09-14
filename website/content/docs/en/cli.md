---
title: Automate with the CLI
description: Install the syncnos CLI so local automation and AI agents can access a running browser profile.
---

The `syncnos` CLI is an optional local automation entry point. Ordinary browser use does not require it. The browser extension and IndexedDB remain the business source of truth; the CLI does not maintain a second SyncNos database.

## Install and connect a browser

```bash
npm install -g @chiimagnus/syncnos@latest
syncnos install
syncnos doctor
```

In the browser profile you want to expose to the CLI, enable:

**Settings → General → Local CLI integration → SyncNos CLI**

That browser profile must remain running while operational commands execute.

## Discover the current surface first

CLI commands and parameters can evolve. The Docs do not duplicate a complete command reference; use the installed version's own output as the source of truth:

```bash
syncnos --help
syncnos capabilities
syncnos settings schema
syncnos doctor
```

## Common workflows

```bash
syncnos instances
syncnos list --limit 20
syncnos search "keyword" --limit 20
syncnos get <conversation-id>
syncnos comments list <conversation-id>
syncnos sync <conversation-id> --to notion
syncnos export markdown <conversation-id> --output ./export
syncnos backup export --output ./syncnos-backup.zip
```

Sync destinations can be `notion`, `obsidian`, `feishu`, or `github`.

## Agent-oriented output

Operational commands use a stable, machine-readable JSON envelope by default:

```json
{ "ok": true, "data": {}, "error": null }
```

`--human` is only for diagnostics / human presentation. Automation should consume JSON rather than parsing ANSI, tables, or natural-language terminal output.

## Mutations and sync

After a state-changing command, read the returned business result. `sync` waits for the accepted job to reach a terminal state by default; use `--no-wait` only when the caller explicitly wants asynchronous behavior.

If a mutation outcome is unknown, read the current state before retrying instead of blindly repeating the write.
