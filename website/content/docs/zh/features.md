---
title: 核心功能
description: 本地优先、备份恢复、评论、图片缓存、Insight、$ Mention 等常用能力。
---

## 本地优先

采集内容先进入浏览器 IndexedDB。同步 Provider 和导出文件是派生副本，不反过来充当 SyncNos 的业务数据库。

## 手动与自动同步

Notion、Obsidian、飞书和 GitHub 使用统一的同步任务生命周期。你可以只手动同步，也可以为需要的 Provider 独立开启自动同步。

## Backup 与恢复

**设置 → Backup** 可以导出和导入恢复包。Backup 可包含本地内容、可恢复的同步 mapping、缓存图片、文章评论和非敏感设置。

认证秘密会被排除，包括 Provider access / refresh token、Client Secret、Obsidian API Key、GitHub Device Flow 凭据等。

## 网页文章评论

保存网页文章后，可以针对正文引用创建评论和回复。评论随本地内容保存，并进入 Backup / Restore 流程；支持的 Provider 可把相应内容纳入同步结果。

## `$` Mention

在支持的 AI 对话输入框中输入 `$`，可以搜索本地保存的条目，并把选中内容以 Markdown 片段插入当前输入框。

## Chat with AI

从已保存内容发起 Chat with AI 时，SyncNos 先把内容复制到剪贴板，再打开配置的 AI 平台。它不会在后台替你自动提交新的 AI 消息。

## 图片缓存

AI 对话与网页文章可以按设置缓存图片。防盗链规则命中时，SyncNos 可调整 Referer 后尝试取得图片。图片失败不会阻塞正文保存。

## Insight

Insight 从本地数据计算采集数量、来源分布、趋势和部分排行，不要求把你的内容上传到 SyncNos 服务。

## 阅读与显示

SyncNos 提供不同 Markdown 阅读风格以及主题设置；这些设置只改变阅读呈现，不改变本地内容本身。

## 本机 CLI

需要让本机 Agent 或自动化访问浏览器中的 SyncNos 数据时，可以显式开启 Native Messaging / CLI 集成。详见[本机 CLI](/docs/cli/)。
