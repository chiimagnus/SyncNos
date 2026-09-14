---
title: Local CLI
description: Install the syncnos CLI so local automation and AI agents can work with a running browser profile.
---

The `syncnos` CLI is an optional local entry point. The browser extension and IndexedDB remain the single business source of truth; the CLI does not maintain a second SyncNos database.

## Install

```bash
npm install -g @chiimagnus/syncnos@latest
syncnos install
syncnos doctor
```

In every browser profile you want to expose, enable:

**Settings → General → Local CLI Integration → SyncNos CLI**

That profile must remain running while business commands execute.

## Discover the current surface

Commands and options evolve, so this documentation intentionally does not duplicate the complete command reference. Treat the installed CLI as canonical:

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

Provider targets are `notion`, `obsidian`, `feishu`, and `github`.

## Agent-oriented output

Operational commands use a stable machine-readable JSON envelope by default:

```json
{ "ok": true, "data": {}, "error": null }
```

`--human` is secondary presentation for diagnostics. Automation should consume JSON instead of parsing ANSI output, tables, or prose.

## Mutations and sync

After state-changing commands, consume the returned business result. `sync` waits for its accepted job to reach a terminal state by default; use `--no-wait` only when the caller explicitly wants asynchronous behavior.

If a mutation outcome is unknown, read back the current state before retrying instead of guessing and repeating the write.
