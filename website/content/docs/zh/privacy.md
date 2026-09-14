---
title: 隐私与数据
description: 内容默认保存在哪里，哪些功能会联网，以及凭据和 Backup 如何处理。
---

本页是面向用户的摘要。完整、持续更新的政策以仓库中的 [PRIVACY.md](https://github.com/chiimagnus/SyncNos/blob/main/PRIVACY.md) 为准。

## 内容默认保存在哪里

采集内容先保存到浏览器本地。SyncNos 不要求把本地库上传到某个 SyncNos 云端内容服务后才能使用。

是否把内容发往外部服务，取决于你实际启用或主动调用的功能。

## 哪些功能会联网

- **Notion**：把你选择同步的内容发送到 Notion API；需要时会处理引用图片。
- **飞书**：把你选择同步的内容发送到飞书 API；OAuth 可使用 Proxy 或 Direct。
- **GitHub**：通过 GitHub App Device Flow 授权，并向 GitHub API 写入仓库内容。
- **ChatGPT Advanced capture**：仅在显式开启后，用当前已登录 ChatGPT 会话执行手动当前对话采集，并可能获取受保护图片。
- **图片缓存**：可能向原始站点 / CDN 请求图片。
- **Obsidian**：默认访问同一台电脑上的 Local REST API，而不是 SyncNos 云服务。

第三方服务收到数据后，适用各自的隐私政策。

## 凭据保存在本地

Provider token、API key、Client Secret 等必要凭据保存在浏览器扩展本地存储中。不同 Provider 的授权方式不同，但这些认证秘密不会写入普通采集内容。

Backup ZIP 也会排除这些认证秘密。Backup 包含什么、适合什么场景见[导出与备份](/docs/export-backup/)。

## 远程代码

扩展的可执行代码随 SyncNos 一起打包；扩展不会从网络下载并执行远程代码。

## 浏览器权限

浏览器 host 权限用于在用户请求的页面进行采集，以及访问配置的 OAuth、同步和图片端点。广泛 host access 并不表示页面正文默认会上传到网络。

需要精确的数据流、权限与凭据边界时，请阅读完整的 [Privacy Policy](https://github.com/chiimagnus/SyncNos/blob/main/PRIVACY.md)。
