---
title: CLI & AI SKILL
description: 让 AI Agent 通过 SyncNos CLI 使用浏览器中的 SyncNos 数据。
---

普通使用不需要 CLI。需要 AI Agent 使用 SyncNos 时：

## 1. 安装 CLI

```bash
npm install -g @chiimagnus/syncnos@latest
syncnos install
syncnos doctor
```

然后在目标浏览器 Profile 中开启：

**设置 → CLI & AI SKILL → 本地 CLI 集成 → SyncNos CLI**

使用时保持该浏览器 Profile 运行。

## 2. 安装 AI SKILL

- [中文 Skill](https://github.com/chiimagnus/SyncNos/tree/main/skills/syncnos-zh)
- [English Skill](https://github.com/chiimagnus/SyncNos/tree/main/skills/syncnos)

安装到 AI Agent 的 Skills 目录即可。命令和连接诊断以本机 `syncnos` CLI 为准。
