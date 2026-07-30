# 模块：WebClipper

## 职责

WebClipper 把 AI 对话、网页正文和视频字幕统一保存为本地 conversation，并提供 popup、app 和 inpage 三种交互面。外部同步和导出都从本地事实源派生。

## 生产入口

| 路径 | 职责 |
| --- | --- |
| `src/entrypoints/background.ts` | 注册消息、存储、OAuth、同步和右键菜单 |
| `src/entrypoints/content.ts` | 装配 collector、页面观察、inpage UI 和抓取控制器 |
| `src/services/bootstrap/current-page-capture.ts` | popup 当前页手动抓取，区分 chat/article |
| `src/services/bootstrap/content-controller.ts` | inpage 单击保存、双击评论、自动/手动采集 |
| `src/collectors/ai-chat-sites.ts` | AI 站点能力与 auto-save / `$` mention 门控 |
| `src/collectors/web/` | article 抽取与站点适配 |
| `src/services/conversations/` | conversation/messages 的本地数据与 handler |
| `src/services/sync/` | Notion、Obsidian、Feishu、备份和自动同步 |

## 采集面

### AI 对话

collector 把各站点 DOM 统一为 conversation + messages。ChatGPT 与 Google AI Studio 只允许显式手动抓取；动态遍历、完整性判定和持久化降级的权威说明见 [数据流：虚拟列表对话的手动完整抓取](../data-flow.md#4-虚拟列表对话的手动完整抓取)。

### 网页正文

article 抽取顺序和清洗逻辑位于 `src/collectors/web/article-extract/`。站点 spec 只负责选择和水合 DOM，统一 Markdown 转换不得被站点旁路。正文抓取失败应返回明确原因，图片失败不影响文本保存。

### 视频字幕

YouTube / Bilibili 只保存页面已经加载的字幕，不下载视频。详见 [videos.md](videos.md)。

## inpage 行为

- `inpage_display_mode` 控制支持站点、所有站点或关闭。
- 单击按钮保存当前内容；双击打开评论侧栏。
- `$` mention 只在 `ai-chat-sites.ts` 明确开启的站点注册。
- article 评论的选区、锚点和 panel 生命周期见 [comments.md](comments.md)。

## 会话列表与详情

- 列表必须从 `getConversationListBootstrap` 开始，再使用 cursor `loadMore`；禁止恢复全量读取。
- detail header 动作通过 `open / tools` 槽位解析，不在具体视图里硬编码 provider。
- `Chat with AI` 是复制 prompt 后跳转，不在后台代表用户提交模型请求。
- `cache-images` 只回填本地消息并刷新详情，不自动触发同步。
- article/video 使用阅读器；chat 不显示 Reader 控件。详见 [reader.md](reader.md)。

## 同步和备份

- provider 通过统一 job store 暴露 running/done/error 状态。
- auto sync 只同步受影响的 conversationId，并使用 MV3 alarm 做一次性唤醒。
- Zip v2 包含 conversations、messages、sync mappings、image cache 和 article comments；敏感 storage key 必须过滤。

## 修改检查

- 新 collector：手动抓取、自动抓取门控、重复数据和空 DOM。
- article 抽取：站点 spec、统一 Markdown、图片失败和 SPA 水合。
- 新详情动作：slot、窄屏/宽屏、popup/app 一致性。
- 新同步行为：本地数据不丢失、job 状态、取消/重试和 provider disabled。
