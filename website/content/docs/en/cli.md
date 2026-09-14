---
title: Automate with the CLI
description: Install the syncnos CLI so local tools or AI agents can use SyncNos data from your browser.
---

You do not need the CLI for ordinary browser use. Install it only when you want local automation.

## Install

```bash
npm install -g @chiimagnus/syncnos@latest
syncnos install
syncnos doctor
```

Then enable this in the browser profile you want to use:

**Settings → General → Local CLI integration → SyncNos CLI**

Keep that browser profile running while using CLI commands.

## See the current commands

Use the installed version as the command reference:

```bash
syncnos --help
syncnos capabilities
syncnos settings schema
syncnos doctor
```

## Common examples

```bash
syncnos instances
syncnos list --limit 20
syncnos search "keyword" --limit 20
syncnos get <conversation-id>
syncnos sync <conversation-id> --to notion
syncnos export markdown <conversation-id> --output ./export
syncnos backup export --output ./syncnos-backup.zip
```

Replace the sync destination with `notion`, `obsidian`, `feishu`, or `github`.

## For automation

The CLI outputs JSON by default so scripts and AI agents can consume it directly.

`sync` waits for completion by default. Add `--no-wait` when you want asynchronous execution.
