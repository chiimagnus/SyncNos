---
title: 隐私与数据
description: 了解内容保存位置、联网场景和 Backup 中的凭据。
---

完整政策见 [PRIVACY.md](https://github.com/chiimagnus/SyncNos/blob/main/PRIVACY.md)。

## 本地优先

采集内容先保存到浏览器本地。不连接外部服务，也可以采集、阅读、搜索、导出和备份。

## 什么时候会联网

只有使用相应功能时才会访问外部服务，例如同步、ChatGPT 高级采集和图片获取。Obsidian 同步使用同一台电脑上的 Local REST API。

## 凭据与 Backup

认证凭据保存在扩展本地，不会写进普通采集内容或普通 Backup。

只有显式勾选 **设置 → Backup → 包含私密数据（用于迁移）** 时，Full Backup 才会包含可迁移凭据。Full Backup 不会被额外加密，请妥善保管。

更多 Backup 说明见[导出与备份](/docs/export-backup/)。

浏览器访问权限用于采集用户选择的页面和连接用户配置的服务；较广的网页权限不表示内容会被默认上传。
