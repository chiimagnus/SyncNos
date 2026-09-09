# 本地数据、备份与恢复边界

本页只维护会影响数据安全、恢复和跨界面一致性的长期契约。具体 object store、索引、schema 版本、storage key、provider 目录和迁移实现以源码与测试为准；这些实现细节变化时，不应机械复制到本文。

## 本地真源

- AI 对话、文章、视频字幕及其消息先保存到浏览器本地；外部同步目标和导出文件都是派生结果。
- conversation 的 canonical 业务时间是 `lastActivityAt`。成功抓取/重抓取，以及评论新增、回复、删除等真实用户活动可以推进它；纯阅读、provider sync、identity rewrite、schema/backup migration 不得用执行时刻伪造 Activity。
- 同步 mapping、cursor、远端状态和其它派生恢复状态不能反向覆盖本地内容事实。
- 虚拟列表来源只有在完整性得到确认后才能做完整快照；不完整采集只能合并已验证内容，不能因为当前 DOM 缺失而删除历史消息。
- 文章评论属于本地文章身份下的独立注释层；根评论既可以包含评论正文，也可以只保留正文引用。手动仅划线必须绑定可验证的定位；外部导入的仅划线必须带稳定来源身份；回复必须保持在线程所属的同一文章身份中且正文非空。
- 图片缓存是增强数据。下载或缓存失败不得阻断正文保存。

## 本地一致性与刷新

- IndexedDB connection 由 canonical connection manager 统一拥有；业务数据层借用连接，不维护第二套 connection lifecycle。
- 受 durable revision 跟踪的数据，业务变更与对应 revision 必须在同一个 IndexedDB transaction 提交；no-op 不得制造 revision。
- post-commit wake 只负责尽快唤醒观察者，不是数据事实真源。consumer 必须重新读取 durable revision，再按变化 scope 重读 canonical 数据；漏掉一次 wake 不能永久留下旧状态。
- canonical read 若 reject，consumer 必须保留 last-good 状态并允许后续 replay；只有成功 resolve 的空值 / `null` 才是 authoritative empty。
- activation-scoped consumer 重新激活时从 canonical 数据恢复。不要重新引入自定义 event/Port 总线作为第二套数据一致性协议。

## Backup ZIP

Backup ZIP 是本地恢复包，不是浏览器数据库文件的物理副本。当前导出使用 canonical `lastActivityAt`；旧 ZIP v2 的 capture-time 字段只在明确的历史恢复边界转换为 Activity，不进入运行时双时间模型。legacy raw JSON backup 不再是受支持的恢复入口。

Backup 可以包含：

- 本地采集内容及消息；
- 可恢复的同步 mapping；
- 可恢复的图片缓存；
- 文章评论；
- 非敏感、可迁移的设置。

认证秘密和设备/授权会话态必须排除，包括 provider access/refresh token、client secret、API key，以及 pending OAuth / Device Flow credential。公开 client metadata、目标目录、repository/branch 等非敏感且可迁移的配置可以按当前策略进入备份。具体 allow/deny 规则以 `src/services/sync/backup/backup-utils.ts` 及其测试为准。

设备特定、可从本地真源重新派生的远端 cleanup/pending 状态不应通过 Backup ZIP 迁移到另一设备；sync mapping 只有在它描述可恢复的本地↔远端 continuity 且不携带秘密时才可备份。

## 恢复与失败语义

- 导入执行合并恢复，不把备份当成无条件覆盖当前本地数据库的镜像；相同备份重复导入应保持幂等，不因时间戳等机械字段制造业务变化或 revision。
- 带稳定外部来源身份的文章评论/划线按“文章上下文 + 来源身份”合并；普通评论按自身内容/上下文身份合并。两类身份不得仅因内容或时间相同而互相吞并，也不能因跨版本正文表示变化制造重复条目。
- ZIP 导入按已提交 stage 推进，不伪装成一个跨阶段巨型事务。后续 stage 失败时，之前已经 commit 的 stage 保持有效；进度只能报告已提交结果，progress callback 失败不能反向撤销业务提交。
- Backup restore 与 schema migration 都不能使用导入/升级发生的当前时间制造 `lastActivityAt`。历史评论只能按其真实 `createdAt` 恢复 owning conversation Activity；合法的未知/零时间保持 unknown。
- manifest、schema 和 ZIP 内路径必须在写入前验证；危险路径、无效结构、声明但实际缺失的 canonical entry 应拒绝导入，不从未声明路径猜测恢复数据。
- 图片缓存 ID 只在 owning conversation 内有意义，也不具备跨数据库可移植性。导入时 asset remap/fallback 必须按 conversation identity 隔离，不能跨 conversation 复用 local ID、blob 或 fallback URL。
- 导入只重写真实 Markdown image target 中的内部 asset URI；普通 prose、inline/fenced/indented code 和 escaped Markdown 中相同文本必须保持原样。
- 可恢复图片应重写为实际恢复出的 local asset；不可恢复的真实图片按安全降级策略处理，不能留下指向不存在或跨 conversation asset 的引用。
- provider 远端写入或 acknowledgement 只有在最终结果明确成功后才能推进本地 continuity；远端失败、结果不完整或 mapping 更新失败不能伪造成功状态，更不能删除或回滚已经成功保存的本地内容。

权限、OAuth 和外部网络数据流见 [PRIVACY.md](../PRIVACY.md)。
