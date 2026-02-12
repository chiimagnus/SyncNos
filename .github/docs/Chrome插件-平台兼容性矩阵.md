# Chrome 插件平台兼容性矩阵（WebClipper）

> 说明：本矩阵用于追踪“平台是否具备四项能力：采集 / 入库 / 导出 / 同步”。其中“采集”与“页面形态”相关的验证需要人工在浏览器中完成；仓库内仅提供 `npm run check/test/build` 的自动化入口。

| 平台 | 站点 | 采集 | 入库 | 导出 | 同步 | 已知问题 |
| --- | --- | --- | --- | --- | --- | --- |
| ChatGPT | `chatgpt.com` / `chat.openai.com` | ✅ | ✅ | ✅ | ✅ | DOM 结构可能变更；依赖 `data-message-author-role` |
| NotionAI | `notion.so` | ✅ | ✅ | ✅ | ✅ | 三形态容器定位不确定时会标记 `container_low_confidence` |
| Claude | `claude.ai` | ✅ | ✅ | ✅ | ✅ | 仅抓“非折叠”正式回复；思考块过滤为启发式 |
| Gemini | `gemini.google.com` | ✅ | ✅ | ✅ | ✅ | DOM 结构可能变更；主要依赖 `#chat-history` 与 `.conversation-container` |
| DeepSeek | `chat.deepseek.com` | ✅ | ✅ | ✅ | ✅ | className 选择器可能变更（demo 参考实现同样依赖 className） |
| Kimi | `kimi.moonshot.cn` / `kimi.com` | ✅ | ✅ | ✅ | ✅ | DOM 结构可能变更；思考块过滤为启发式 |
| Doubao | `www.doubao.com` | ✅ | ✅ | ✅ | ✅ | DOM 结构可能变更；依赖 `data-testid` |
| Yuanbao | `yuanbao.tencent.com` | ✅ | ✅ | ✅ | ✅ | DOM 结构可能变更；依赖 className |
| 文章 | 任意 `http(s)` | ✅（手动 Fetch） | ✅ | ✅ | ✅ | 需要用户授予当前站点可选权限；正文提取为轻量启发式（非 Readability） |

