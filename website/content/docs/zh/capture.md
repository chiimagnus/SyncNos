---
title: 采集内容
description: SyncNos 支持保存什么，以及不同来源应该手动采集还是自动保存。
---

## 先看采集方式

| 内容 | 默认方式 |
| --- | --- |
| AI 对话 | 因站点而异：ChatGPT / Google AI Studio 手动，其它支持站点可自动保存 |
| 网页文章 | 手动采集 |
| YouTube / Bilibili 视频内容 | 手动采集 |

无论来源是什么，采集结果都会先写入 SyncNos 本地库。

## AI 对话

当前支持：

| 平台 | 默认采集方式 |
| --- | --- |
| ChatGPT | 手动采集 |
| Gemini | 可自动保存 |
| Google AI Studio | 手动采集 |
| DeepSeek | 可自动保存 |
| Kimi | 可自动保存 |
| 豆包 | 可自动保存 |
| 元宝 | 可自动保存 |
| Poe | 可自动保存 |
| Notion AI | 可自动保存 |
| z.ai | 可自动保存 |

**ChatGPT 与 Google AI Studio 使用虚拟列表。**离开视口的历史轮次可能不在当前 DOM 中，因此 SyncNos 不把它们加入普通自动保存，而是在你主动采集时执行完整性准备流程。

ChatGPT 还提供可选的 **Advanced capture**。显式开启后，手动采集可使用当前已登录 ChatGPT 会话请求当前对话数据；它仍然只在你主动保存时运行，不会变成后台轮询或自动采集。

## 网页文章

网页文章由用户主动采集。SyncNos 会尝试提取正文，以及标题、URL、作者、发布时间等可用元数据，并转换成适合本地阅读和导出的 Markdown。

部分站点有专门处理逻辑。图片下载失败不会阻止正文保存。

## 视频内容

YouTube 和 Bilibili 视频页支持保存当前页面内容，并采集页面已经加载的字幕 / transcript；来源提供时间信息时会一并保留。

SyncNos 不生成不存在的字幕，也不下载音视频流。即使当前没有字幕，受支持的视频仍可以作为 Video 保存。

## 图片缓存

AI 对话和网页文章可以按设置缓存图片。防盗链规则命中时，SyncNos 可以调整 Referer 后尝试取得原图；图片缓存失败不会让正文采集失败。

导出 Markdown / JSON 时，实际被内容引用且已经缓存的图片可以随导出文件一起带走。详见[导出与备份](/docs/export-backup/)。

## 采集之后

- 在[本地库](/docs/library/)中阅读、搜索和管理；
- 为文章添加高亮、评论和回复；
- [同步到外部服务](/docs/sync/)；
- [导出 Markdown / JSON 或创建 Backup](/docs/export-backup/)。
