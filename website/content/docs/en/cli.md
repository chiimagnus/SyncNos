---
title: CLI & AI SKILL
description: Let AI agents use SyncNos through the local CLI.
---

You do not need the CLI for ordinary browser use. Set it up when you want an AI agent to use SyncNos.

## 1. Install the CLI

```bash
npm install -g @chiimagnus/syncnos@latest
syncnos install
syncnos doctor
```

Then enable it in the browser profile you want to use:

**Settings → CLI & AI SKILL → Local CLI Integration → SyncNos CLI**

Keep that browser profile running while the agent uses SyncNos.

## 2. Install the AI SKILL

Choose the language you want:

- [`skills/syncnos/`](https://github.com/chiimagnus/SyncNos/tree/main/skills/syncnos): English
- [`skills/syncnos-zh/`](https://github.com/chiimagnus/SyncNos/tree/main/skills/syncnos-zh): 中文

Install the selected Skill in the Skills directory used by your AI agent. The exact location depends on the agent.

After that, ask the agent to use SyncNos directly. The Skill treats the installed CLI as the command source of truth and uses `syncnos doctor` first when the local connection needs diagnosis.
