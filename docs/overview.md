# SyncNos 文档

SyncNos WebClipper 与 SyncNos CLI 是两个独立交付物，共享 Local Database / Native Host / SQLite 数据契约。跨产品的数据 authority、安全与搜索规则见 [storage.md](storage.md)。

## SyncNos CLI

| 目标 | 页面 |
| --- | --- |
| 本地编译、运行、测试与真正生成 `.tgz` | [cli/development.md](cli/development.md) |
| CLI 安装、`doctor`、Native Host 与修复边界 | [cli/local-database.md](cli/local-database.md) |
| 本机 npm 发布 | [cli/releasing.md](cli/releasing.md) |
| 最终用户命令与 JSON 输出 | [packages/syncnoscli/README.md](../packages/syncnoscli/README.md) |

## WebClipper

| 目标 | 页面 |
| --- | --- |
| 产品模型与不可破坏的采集规则 | [webclipper/overview.md](webclipper/overview.md) |
| 设置、开发构建、环境变量与本地浏览器测试 | [webclipper/configuration.md](webclipper/configuration.md) |
| Settings 中启用、join、迁移与恢复 Local Database | [webclipper/local-database.md](webclipper/local-database.md) |
| 浏览器 tag / Actions / 商店发布与 release evidence | [webclipper/releasing.md](webclipper/releasing.md) |
| Feishu / Lark DocX 配置指南 | [guide/feishu/DocxSync.zh.md](guide/feishu/DocxSync.zh.md) |
| Obsidian Local REST API 用户配置指南 | [guide/obsidian/LocalRestAPI.zh.md](guide/obsidian/LocalRestAPI.zh.md) |

## 共享契约

- [storage.md](storage.md)：Local Database 生命周期、facts authority、SQLite 搜索、安全与备份边界。

代码结构、符号和调用关系以 CodeGraph 为准；不可违反的分层和交互规则在根 [AGENTS.md](../AGENTS.md)。
