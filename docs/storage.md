# 本地数据、备份与恢复边界

本页只维护会影响数据安全和恢复行为的长期契约。具体 object store、索引、schema 版本和迁移以 `src/platform/idb/schema.ts` 及相关数据层源码为准。

## 本地真源

- AI 对话、文章、视频字幕及其消息内容先保存到浏览器本地；外部同步目标和导出文件都是派生结果。
- 同步 mapping、cursor 或远端状态不能反向覆盖本地内容事实。
- 虚拟列表来源只有在完整性得到确认后才能做完整快照；不完整采集只能追加已验证内容，不能因为当前 DOM 缺失而删除历史消息。
- 文章评论属于本地文章身份下的独立注释层；回复必须保持在线程所属的同一文章身份中。
- 图片缓存是增强数据。下载或缓存失败不得阻断正文保存。

## 备份

当前 Zip 备份用于恢复本地数据，而不是复制浏览器内部数据库文件。它可包含：

- 本地采集内容及其消息；
- 同步映射；
- 可恢复的图片缓存；
- 文章评论；
- 非敏感设置。

认证秘密必须被排除。当前过滤至少覆盖 Notion / Feishu OAuth token、相关 client secret、Obsidian Local REST API key，以及 `github_auth_state_v1` / `github_auth_*` 中的 GitHub access token、refresh token 和 pending Device Flow credential；实际过滤逻辑以 `src/services/sync/backup/backup-utils.ts` 为准。

GitHub 的 repository 与 branch 属于非敏感配置，可按现有 storage backup 策略恢复。GitHub 三类输出目录固定为 `AIChats`、`WebArticles`、`VideosScripts`，不属于用户设置，也没有对应的 storage key。GitHub App Client ID 是公开应用配置；扩展中不存在 GitHub Client Secret 或 GitHub App private key。

## GitHub 恢复状态

- GitHub auth/pending state 存在 `chrome.storage.local` 的 `github_auth_state_v1`，属于 secret/runtime state，不进入 Zip backup。
- GitHub remote cleanup outbox 存在 IndexedDB 的 `github_cleanup_outbox`，用于在删除、identity move 或网络失败后恢复受管远端路径清理；它是派生恢复状态，不进入 Zip backup，也不应通过导入恢复为另一台设备上的待执行远端操作。
- GitHub sync mapping 可以进入既有 mapping backup，因为它描述本地内容与派生远端 projection 的连续性；它不能携带 access/refresh/device secret。

## 导入与失败语义

- 导入执行合并恢复，不把备份当成无条件覆盖当前本地数据库的镜像。
- 备份 manifest、schema 和 Zip 内部路径必须先验证；危险路径或无效结构应拒绝导入。
- 某些非关键资产无法恢复时，应保留明确 warning / 降级结果，而不是写入损坏数据。
- 外部同步失败不能删除或回滚已经成功保存的本地内容。

更广泛的权限、OAuth 和网络行为见 [PRIVACY.md](../PRIVACY.md)。
