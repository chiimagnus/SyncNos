---
title: 本机 CLI
description: 安装 syncnos CLI，让本机自动化和 AI Agent 访问正在运行的浏览器 Profile。
---

`syncnos` CLI 是可选的本机入口。浏览器扩展和 IndexedDB 仍然是唯一业务真源；CLI 不维护第二套 SyncNos 数据库。

## 安装

```bash
npm install -g @chiimagnus/syncnos@latest
syncnos install
syncnos doctor
```

在要暴露给 CLI 的浏览器 Profile 中开启：

**设置 → 通用 → 本地 CLI 集成 → SyncNos CLI**

业务命令执行时，该 Profile 需要保持运行。

## 先发现能力

CLI 的命令和参数会持续演进，不要依赖文档复制一份完整命令表。以当前安装版本自己的输出为真源：

```bash
syncnos --help
syncnos capabilities
syncnos settings schema
syncnos doctor
```

## 常用工作流

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

Provider 目标可为 `notion`、`obsidian`、`feishu` 或 `github`。

## 面向 Agent 的输出契约

默认 operational command 使用稳定、可机器解析的 JSON envelope：

```json
{ "ok": true, "data": {}, "error": null }
```

`--human` 只用于诊断 / 人类展示。自动化应读取 JSON，而不是解析 ANSI、表格或自然语言终端文本。

## 写入与同步

状态修改命令执行后应读取返回的业务结果。`sync` 默认等待本次 accepted job 到 terminal state；只有调用者明确希望异步时才使用 `--no-wait`。

如果 mutation 的结果未知，先 read-back 当前状态，不要猜测性地重复执行同一个写入。
