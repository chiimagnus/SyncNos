---
title: CLI & AI SKILL
description: Let an AI agent use SyncNos browser data through the SyncNos CLI.
---

Normal use does not require the CLI. For AI-agent access:

## 1. Install the CLI

```bash
npm install -g @chiimagnus/syncnos@latest
syncnos install
syncnos doctor
```

Then enable this in the target browser profile:

**Settings → CLI & AI SKILL → Local CLI Integration → SyncNos CLI**

Keep that browser profile running while the agent uses it.

## 2. Install the AI SKILL

- [English Skill](https://github.com/chiimagnus/SyncNos/tree/main/skills/syncnos)
- [中文 Skill](https://github.com/chiimagnus/SyncNos/tree/main/skills/syncnos-zh)

Install the chosen Skill in your AI agent's Skills directory. Treat the local `syncnos` CLI as the command and connection source of truth.
