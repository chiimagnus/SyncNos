---
title: Obsidian
description: 把 SyncNos 内容同步到你的 Obsidian vault。
---

SyncNos 通过 Obsidian 的 **Local REST API** 插件写入内容。

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

## 遇到问题

- `Failed to fetch`：确认 Obsidian、插件和本机 HTTP 都已运行。
- `401` / `403`：重新复制 API Key，并确认 Auth Header。
