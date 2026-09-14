---
title: 隐私与数据
description: 了解内容保存位置、联网场景、凭据和浏览器权限。
---

本页只做快速说明。完整政策见 [PRIVACY.md](https://github.com/chiimagnus/SyncNos/blob/main/PRIVACY.md)。

## 内容默认保存在本地

采集内容会先保存到浏览器本地。

不连接任何外部服务，也可以正常采集、阅读、搜索、导出和备份。

## 什么情况下会联网

只有你启用或主动使用相关功能时，SyncNos 才会访问对应服务，例如：

- 同步到 Notion、飞书或 GitHub
- 使用同一台电脑上的 Obsidian Local REST API
- 开启 ChatGPT 高级采集
- 缓存或获取内容中的图片

数据发送给第三方后，适用对应服务自己的隐私政策。

## 凭据和 Backup

同步服务需要的 token、API Key、Client Secret 等认证信息保存在扩展本地。

这些认证秘密不会写进普通采集内容，也不会进入 SyncNos Backup。

Backup 的用途见[导出与备份](/docs/export-backup/)。

## 浏览器权限

SyncNos 需要访问你要采集的页面，以及你主动配置的同步、授权和图片地址。

较广的网页访问权限并不表示页面内容会被默认上传。

SyncNos 的扩展代码随安装包提供，不会从网络下载并执行远程代码。

需要完整的数据流、权限和凭据说明时，请阅读 [PRIVACY.md](https://github.com/chiimagnus/SyncNos/blob/main/PRIVACY.md)。
