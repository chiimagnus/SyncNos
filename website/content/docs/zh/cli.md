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
syncnos sync <conversation-id> --to notion
syncnos export markdown <conversation-id> --output ./export
syncnos backup export --output ./syncnos-backup.zip
```

同步目标可以换成 `notion`、`obsidian`、`feishu` 或 `github`。

## 给自动化使用

CLI 默认输出 JSON，适合脚本和 AI Agent 读取。

`sync` 默认等待同步完成；需要异步执行时可以加 `--no-wait`。
