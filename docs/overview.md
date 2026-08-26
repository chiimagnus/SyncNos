# SyncNos WebClipper 文档

长期文档只维护无法从源码和 CodeGraph 直接推导、但会影响使用、贡献或故障处理的知识。源码结构、符号和调用关系以 CodeGraph 为准。

## 从这里开始

| 目标 | Canonical 文档 |
| --- | --- |
| 了解产品、安装与支持来源 | [README.md](../README.md) / [README.zh-CN.md](../README.zh-CN.md) |
| 查看隐私、权限、网络与数据去向 | [PRIVACY.md](../PRIVACY.md) |
| 提交 Issue、commit 或 Pull Request | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 理解本地数据、备份与恢复边界 | [storage.md](storage.md) |
| 配置 Feishu DocX | [feishu-setup.md](feishu-setup.md) |
| 配置 Obsidian Local REST API | [obsidian-setup.md](obsidian-setup.md) |
| 排查构建、采集、消息连接与评论定位 | [troubleshooting.md](troubleshooting.md) |
| 查看架构边界与 agent 约束 | [AGENTS.md](../AGENTS.md) |

## 事实归属

不要把下面这些高漂移事实复制成第二份清单：

| 事实 | 真源 |
| --- | --- |
| 支持的 AI 站点与自动保存资格 | `src/collectors/ai-chat-sites.ts` 与 capture-integrity 协议 |
| 浏览器权限、host permissions、构建期变量 | `wxt.config.ts` |
| npm 命令与依赖 | `package.json` |
| IndexedDB schema 与迁移 | `src/platform/idb/schema.ts` |
| 设置值的归一化与兼容读取 | `src/services/protocols/**` 及对应 service |
| 分层、依赖方向和不可破坏产品 invariant | 根 `AGENTS.md` |

## 产品数据模型

SyncNos 先把 AI 对话、网页文章和已加载的视频字幕保存到浏览器本地；评论、图片缓存和同步映射围绕这些本地内容工作。Notion、Obsidian、Feishu 与导出文件都是派生结果，不是本地内容的替代真源。

具体存储与恢复约束见 [storage.md](storage.md)。
