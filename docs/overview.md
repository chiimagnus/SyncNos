# SyncNos WebClipper 文档

SyncNos 将 AI 对话、网页文章和已加载的视频字幕统一为本地 conversation；事实 authority 默认是浏览器 IndexedDB，用户显式启用 Local Database 后切换到当前用户的 SQLite。同步和导出始终只是派生产物，具体迁移与 authority 规则见 [storage.md](storage.md)。

## 入口

| 目标 | 页面 |
| --- | --- |
| Local Database 的事实模型、迁移、搜索与安全边界 | [storage.md](storage.md) |
| Local Database / Native Host / CLI 安装与恢复 | [local-database.md](local-database.md) |
| SyncNos CLI 命令与 JSON 输出 | [packages/syncnoscli/README.md](../packages/syncnoscli/README.md) |
| 开发、构建、环境变量与本地浏览器测试 | [configuration.md](configuration.md) |
| WebClipper / CLI 发布边界与 release evidence | [releasing.md](releasing.md) |
| Feishu / Lark DocX 配置指南 | [.github/guide/feishu/DocxSync.zh.md](../.github/guide/feishu/DocxSync.zh.md) |
| Obsidian Local REST API 用户配置指南 | [.github/guide/obsidian/LocalRestAPI.zh.md](../.github/guide/obsidian/LocalRestAPI.zh.md) |

代码结构、符号和调用关系以 CodeGraph 为准；不可违反的分层和交互规则在根 [AGENTS.md](../AGENTS.md)。

## 产品模型

| 来源 | `sourceType` | 本地内容 |
| --- | --- | --- |
| AI 对话 | `chat` | 标准化消息序列 |
| 网页正文 | `article` | `article_body`，可附评论线程 |
| 视频字幕 | `video` | `video_transcript`，可带时间戳 |

## 不可破坏的产品规则

- 采集以本地落库成功为准；远端失败不能丢失本地内容。
- ChatGPT 与 Google AI Studio 的虚拟列表只允许显式手动完整抓取，不得加入自动保存。
- 图片缓存和反防盗链是增强项，失败不得阻断正文保存。
- Reader 只用于 `article` 和 `video`；AI chat 不显示阅读器工具。
- 评论是 article 的本地注释层：只有根评论可记录 locator，且只接受全局唯一 exact Range；失败显示 unavailable，不做模糊回退。
- `$` mention 的站点支持以 `src/collectors/ai-chat-sites.ts` 为准；使用 `$` 打开候选，`Tab`/`Enter` 插入。
- 会话列表只能走 `bootstrap + loadMore` 分页，禁止恢复全量读取。
- OAuth token、client secret 等敏感数据不得进入备份；外部 mapping/cursor 不能反向覆盖本地事实。
