# 本地数据、备份与恢复边界

本页只维护会影响数据安全和恢复行为的长期契约。具体 object store、索引、schema 版本和迁移以 `src/platform/idb/schema.ts` 及相关数据层源码为准。

## 本地真源

- AI 对话、文章、视频字幕及其消息内容先保存到浏览器本地；外部同步目标和导出文件都是派生结果。
- 同步 mapping、cursor 或远端状态不能反向覆盖本地内容事实。
- 虚拟列表来源只有在完整性得到确认后才能做完整快照；不完整采集只能追加已验证内容，不能因为当前 DOM 缺失而删除历史消息。
- 文章评论属于本地文章身份下的独立注释层；回复必须保持在线程所属的同一文章身份中。
- 图片缓存是增强数据。下载或缓存失败不得阻断正文保存。

## 本地一致性与刷新

- `src/platform/idb/schema.ts` 的 canonical connection manager 统一拥有 IndexedDB connection 生命周期。业务数据层只借用 `openDb()` 返回的连接，不再维护各自的 connection cache，也不关闭借来的 canonical connection；`versionchange` / close 后由 manager 失效当前连接，下一次 `openDb()` 再建立连接。
- `conversations`、`messages`、`sync_mappings`、`article_comments`、`image_cache` 的 durable revision 是跨 surface 数据一致性的 correctness 真源。对这些 scope 的实际业务变更与 revision 递增必须位于同一 IndexedDB transaction；no-op 不得制造 revision。
- post-commit wake 只负责尽快唤醒观察者，不能作为“数据已经是什么”的事实真源。观察者必须重新读取 durable revision snapshot，再按发生变化的 scope 重读 canonical 数据；不能因为漏掉一次 wake 就永久停留在旧状态。
- consumer 的 canonical read 若 reject，必须保留 last-good 状态并允许对同一 revision replay；只有成功 resolve 的空值 / `null` 才能当 authoritative empty。visibility / focus / pageshow 与可见期 safety reconcile 用于补偿丢失的提示，不应在 revision 未变化时制造业务 reread storm。
- Comments、Insight、mention 等 activation-scoped consumer 只在对应 session / surface 活跃时持有订阅；重新激活时从 canonical 数据恢复。不要重新引入自定义 event/Port 总线作为本地数据正确性的第二套协议。

## 备份

当前 Zip 备份用于恢复本地数据，而不是复制浏览器内部数据库文件。它可包含：

- 本地采集内容及其消息；
- 同步映射；
- 可恢复的图片缓存；
- 文章评论；
- 非敏感设置。

认证秘密与不可迁移的授权会话态必须被排除。当前过滤至少覆盖 Notion / Feishu OAuth token、相关 client secret、Notion 的固定 client-id 历史镜像、Notion / Feishu OAuth pending/error attempt state、Obsidian Local REST API key，以及 `github_auth_state_v1` / `github_auth_*` 中的 GitHub access token、refresh token 和 pending Device Flow credential；实际过滤逻辑以 `src/services/sync/backup/backup-utils.ts` 为准。OAuth pending/error 仍可保存在当前浏览器的 `storage.local` 中跨 MV3 worker/reload 协调同一台机器上的授权 callback，但不能通过 Zip backup 迁移到另一时刻或设备。Feishu client ID、HTTPS token-exchange proxy URL 与 chat/article/video folder path 属于真实可迁移配置，仍可按现有策略进入备份。

GitHub 的 repository 与 branch 属于非敏感配置，可按现有 storage backup 策略恢复。GitHub 三类输出目录固定为 `AIChats`、`WebArticles`、`VideosScripts`，不属于用户设置，也没有对应的 storage key。GitHub App Client ID 是公开应用配置；扩展中不存在 GitHub Client Secret 或 GitHub App private key。

Inpage 显示设置只使用 `inpage_display_mode`（`supported | all | off`）。运行时、Settings、context menu 与 backup 都只读取和写入这一 canonical key；backup 会丢弃其它退役的 `inpage_*` storage residue。无设置或值非法时使用运行默认 `all`，startup 会清理非法 canonical residue，但不会为了默认值凭空物化 storage key。

## GitHub 恢复状态

- GitHub auth/pending state 存在 `chrome.storage.local` 的 `github_auth_state_v1`，属于 secret/runtime state，不进入 Zip backup。
- pending Device Flow 的 remote-state discovery 不得把单个 UI timer 当成 correctness 唯一来源。设置页面在重新可见、重新获得焦点或 pageshow 时，只在持久化 `nextPollAt` 已到期后补做 reconcile；poll interval、`slow_down`、expiry 与跨调用 claim 仍由 Device Flow service 和 durable auth state 最终裁决。timer / lifecycle wake 的并发触发必须合并，且授权收敛不得因无关设置操作而长期阻塞。
- mount hydration、auth storage wake 与 poll-error recovery 可能并发读取 GitHub safe auth snapshot；较旧响应不得覆盖更新的已应用 auth 状态。较新的读取失败只保留 last-good，不得把失败解释成 disconnected，也不能让乱序响应把 connected 回退为 pending。
- GitHub remote cleanup outbox 存在 IndexedDB 的 `github_cleanup_outbox`，用于在删除、identity move 或网络失败后恢复受管远端路径清理；它是派生恢复状态，不进入 Zip backup，也不应通过导入恢复为另一台设备上的待执行远端操作。
- GitHub sync mapping 可以进入既有 mapping backup，因为它描述本地内容与派生远端 projection 的连续性；它不能携带 access/refresh/device secret。

## 导入与失败语义

- 导入执行合并恢复，不把备份当成无条件覆盖当前本地数据库的镜像；相同备份重复导入应保持幂等，不因为时间戳或其他机械字段制造业务变化与 revision。
- Zip 导入按已提交 stage 推进，而不是把整个 archive 伪装成单个跨阶段事务。后续 stage 失败时，之前已经 commit 的 stage 保持有效；进度只能报告已经 commit 的阶段。Legacy / Zip 的 progress listener 都是 best-effort side effect：同步 throw 或异步 reject 不得把已经提交的导入 stage 反向解释成失败。
- 备份 manifest、schema 和 Zip 内部路径必须先验证；危险路径或无效结构应拒绝导入。
- `image_cache` row 的本地 ID 只在其 owning `conversationId` 内有意义，也不具备跨数据库可移植性。任何读取、导出或外部物化都不能仅凭全局自增 ID 跨 conversation 取图。
- Zip backup 的 image-cache index 中，old asset ID 同样只在该 index item 的 `uniqueKey` 所属 conversation 内有意义。导入恢复时 old-ID -> local-ID remap 与 fallback 必须按 `uniqueKey` 隔离；一个 conversation 的消息不能消费另一个 conversation 的 remap、blob 或 fallback URL。
- 导入只重写**真实 Markdown image target** 中的 `syncnos-asset://...`。普通 prose、inline code、fenced code、indented code 或 escaped Markdown 中相同 URI / 图片示例都不是 asset reference，必须保持原文，不得参与 remap/fallback。
- 真实内部图片恢复成功时重写到 owning conversation 实际恢复出的 local asset ID；即使重复导入时本地 cache row 曾被删除并重新分配 ID，也不能留下指向旧 ID 的真实图片引用。malformed/non-positive/unsafe、cross-conversation、index/blob 缺失等不可恢复真实图片按当前导入策略降级到安全 placeholder，或仅在当前 `uniqueKey` 自己拥有可用 fallback 时回退到原始 `http(s)` / `data:` 图片来源。
- 某些非关键资产无法恢复时，应保留明确 warning / 降级结果，而不是写入损坏数据。
- 外部同步失败不能删除或回滚已经成功保存的本地内容。

更广泛的权限、OAuth 和网络行为见 [PRIVACY.md](../PRIVACY.md)。
