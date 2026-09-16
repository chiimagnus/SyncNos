---
title: 使用 CLI 自动化
description: 安装 syncnos CLI，让本机工具或 AI Agent 使用浏览器中的 SyncNos 数据。
---

普通浏览器使用不需要 CLI。只有需要本机自动化时才安装它。

## 安装

```bash
npm install -g @chiimagnus/syncnos@latest
syncnos install
syncnos doctor
```

然后在要使用的浏览器 Profile 中开启：

**设置 → 通用 → 本地 CLI 集成 → SyncNos CLI**

执行 CLI 命令时，这个浏览器 Profile 需要保持运行。

## 查看当前命令

命令和参数以你安装的版本为准：

```bash
syncnos --help
syncnos capabilities
syncnos settings schema
syncnos doctor
```

## 常用示例

```bash
syncnos instances
syncnos list --limit 20
syncnos search "keyword" --limit 20
syncnos get <conversation-id>
syncnos comments add <conversation-id> --text "一条评论"
syncnos comments reply <conversation-id> <parent-comment-id> --text "一条回复"
syncnos sync <conversation-id> --to notion
syncnos export markdown <conversation-id> --output ./export
syncnos backup export --output ./syncnos-backup.zip
```

同步目标可以换成 `notion`、`obsidian`、`feishu` 或 `github`。

## AI Agent Skill

仓库自带可直接使用的 CLI Skill：`skills/syncnos-zh/`（中文）和 `skills/syncnos/`（English）。Skill 以本机已安装 CLI 为命令真源，CLI / Native Messaging 出错时会先用 `syncnos doctor` 自主诊断并处理可恢复问题，再决定是否需要浏览器侧人工步骤。

## 给自动化使用

CLI 默认输出 JSON，适合脚本和 AI Agent 读取。

通过 CLI 为网页文章创建的评论和回复会显示为 `<About You 用户名>' CLI`；如果没有配置 About You 用户名，则显示为 `CLI`。这样可以和你在浏览器界面里直接写的评论区分开。

`sync` 默认等待同步完成；需要异步执行时可以加 `--no-wait`。
