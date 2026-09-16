---
title: CLI & AI SKILL
description: 让 AI Agent 通过 SyncNos CLI 使用浏览器中的 SyncNos 数据。
---

普通使用不需要 CLI。需要让 AI Agent 使用 SyncNos 时，完成下面两步即可。

## 1. 安装 CLI

```bash
npm install -g @chiimagnus/syncnos@latest
syncnos install
syncnos doctor
```

然后在要使用的浏览器 Profile 中开启：

**设置 → CLI & AI SKILL → 本地 CLI 集成 → SyncNos CLI**

使用时保持这个浏览器 Profile 运行。

## 2. 安装 AI SKILL

选择需要的语言版本：

- [`skills/syncnos-zh/`](https://github.com/chiimagnus/SyncNos/tree/main/skills/syncnos-zh)：中文
- [`skills/syncnos/`](https://github.com/chiimagnus/SyncNos/tree/main/skills/syncnos)：English

把所选 Skill 安装到你使用的 AI Agent 的 Skills 目录。不同 Agent 的目录可能不同，以对应 Agent 的说明为准。

安装后直接让 Agent 使用 SyncNos 即可。Skill 会以本机已安装的 CLI 为命令真源；连接异常时会先使用 `syncnos doctor` 诊断。
