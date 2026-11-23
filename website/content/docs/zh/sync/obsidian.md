---
title: Obsidian
description: 把内容同步到 Obsidian，并设置笔记与图片的保存位置。
---

SyncNos 通过 Obsidian 的 **Local REST API** 插件，把已保存的 AI 对话、网页文章和视频内容写入本地笔记库。

## 1. 安装插件

在 Obsidian Desktop 的 **设置 → 第三方插件** 中安装并启用 **Local REST API**。

![安装 Obsidian Local REST API 插件](/assets/docs/obsidian/obsidian-install-plugin.png)

## 2. 开启本机 HTTP

在插件设置中开启 **Non-encrypted / Insecure HTTP server**。默认地址：

```text
http://127.0.0.1:27123
```

保持 `127.0.0.1` 或 `localhost`，不要开放到局域网。

![启用本机 HTTP 服务](/assets/docs/obsidian/obsidian-enable-insecure-http.png)

## 3. 连接 SyncNos

复制插件的 **API Key**，打开 **SyncNos → 设置 → Obsidian**：

- **Base URL**：通常保持默认地址
- **API Key**：粘贴刚复制的 key
- **Auth Header**：保持 `Authorization`

点击 **测试**。成功后即可手动同步或开启自动同步。

![在 SyncNos 中配置 API Key](/assets/docs/obsidian/obsidian-copy-api-key.png)

## 设置笔记与图片的位置

在 **SyncNos → 设置 → Obsidian → Obsidian 路径** 中，AI 对话、网页剪藏、视频脚本各占一行：
左边填写对应内容的文件夹，右边填写 **附件文件夹**。按 Enter 或移开光标即可保存。

**所有路径均相对于 Obsidian 笔记库根目录**。例如，AI 对话文件夹填 `AI`，附件文件夹填 `assets`：

- 笔记保存在 `AI/example.md`。
- 图片保存在 `assets/example-1.png`，而非 `AI/assets/`。
- 笔记中的图片链接自动指向 `../assets/example-1.png`。

文件名仅作示意。其他两类附件文件夹也填 `assets`，即可共用同一个图片目录。
支持多级目录及空格，例如 `syncnos/AI clipper/ai/assets`。

**附件文件夹留空（默认）或填 `.`**，图片就与对应笔记放在一起。
路径不能超出笔记库；不要以 `/` 或 `../` 开头。

修改路径后，再次同步会把可获取的图片写到新位置并更新引用，**不会自动删除旧图片**。
同步可能覆盖 Obsidian 中手动编辑的笔记，重新同步前请先备份这些修改。

## 遇到问题

- `Failed to fetch`：确认 Obsidian、插件和本机 HTTP 都已运行。
- `401` / `403`：重新复制 API Key，并确认 Auth Header。
