# WebClipper 产品契约

WebClipper 负责采集 AI 对话、网页文章和已加载的视频字幕，并把它们统一为本地 conversation。Local Database 的共享 authority 与安全边界见 [`../storage.md`](../storage.md)。

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
