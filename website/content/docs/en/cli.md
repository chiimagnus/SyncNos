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
syncnos comments add <conversation-id> --text "A comment"
syncnos comments reply <conversation-id> <parent-comment-id> --text "A reply"
syncnos sync <conversation-id> --to notion
syncnos export markdown <conversation-id> --output ./export
syncnos backup export --output ./syncnos-backup.zip
```

Replace the sync destination with `notion`, `obsidian`, `feishu`, or `github`.

## AI-agent Skill

The repository ships ready-to-use CLI Skills at `skills/syncnos/` (English) and `skills/syncnos-zh/` (中文). They use the installed CLI as the command source of truth and diagnose recoverable CLI / Native Messaging failures with `syncnos doctor` before escalating to manual browser steps.

## For automation

The CLI outputs JSON by default so scripts and AI agents can consume it directly.

Comments and replies created through the CLI for web articles are displayed as `<About You name>' CLI`; when no About You name is configured, they are displayed as `CLI`. This keeps automation-authored notes distinct from comments you write directly in the browser UI.

`sync` waits for completion by default. Add `--no-wait` when you want asynchronous execution.
