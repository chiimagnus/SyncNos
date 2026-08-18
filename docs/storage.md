# 本地数据与安全边界

## Local Database 生命周期与固定位置

Local Database **默认不启用**。新 browser profile 没有 migration journal 时是 `not_started` / `idb-v1`；只有用户在 **Settings → Backup → Local Database** 明确确认启用，或在检测到既有共享数据库后明确确认 join，才会进入迁移。发现磁盘上已有 SQLite 不能自动把一个新 profile 认领成 active。

SQLite 只使用固定的 per-user hidden directory：macOS/Linux 为 `~/.syncnoscli/syncnos.sqlite`，Windows 为 `%USERPROFILE%\.syncnoscli\syncnos.sqlite`。没有自定义 database-path 设置，不支持把开放的 SQLite 放到共享网络盘、云盘目录或其它进程直接同步；浏览器请求也不能携带任意 path。Windows 的 `.syncnoscli` 目录由 CLI 标记 Hidden，Unix 目录/数据库使用 owner-only 权限边界。

迁移的事实集合固定为五类：`conversations`、`sync_mappings`、`messages`、`image_cache`、`article_comments`。迁移使用有 byte ceiling、sequence/digest 校验的 Native Messaging stream 先写 staging，再验证 receipt、profile references 与 cleanup 状态；中断后按 journal 恢复，不能靠第二套 backend 绕过 transitional gate。

## 会话事实 authority

会话事实只有一个 authority，具体由 Local Database migration journal 决定；不存在长期双写或 active-mode fallback。

| journal / mode | 会话事实 authority | 规则 |
| --- | --- | --- |
| `not_started` / `idb-v1` | IndexedDB | `conversations`、`messages`、`sync_mappings`、`image_cache`、`article_comments` 仍由浏览器 profile 的 IDB 提供。 |
| transitional | 无可绕过的第二 authority | migration gate 阻止不安全的 facts operation；不能一边迁移一边回退读写另一 backend。 |
| `active` / `native:*` | `~/.syncnoscli/syncnos.sqlite` 或 `%USERPROFILE%\.syncnoscli\syncnos.sqlite`（通过 SyncNos Native Host） | list/detail/tail/search/comments/mapping/capture 等 facts operation 只走 SQLite；浏览器不得因 Host/FTS 错误回退到旧 IDB facts。验证激活与 profile reference rebase 完成后，旧 IDB facts 才按迁移流程清理。 |

`chrome.storage.local` 保存跨界面设置、OAuth 状态、同步配置和 bounded job/profile snapshot；它不是会话正文。`localStorage` / `sessionStorage` 只保存筛选、导航和布局等 UI 临时状态，也不得承载共享 facts。Notion、Obsidian、Feishu 和导出文件都是本地 facts 的派生结果，不能反向成为 conversation authority。

`article_comments` 是 article 的独立注释层；根评论可有 locator，回复必须属于同一 article identity 的根线程。删除 conversation 时必须同时清理其消息、mapping 和所属的派生引用。

迁移 journal、provider/OAuth 设置等仍是 browser-profile-local 状态，因此卸载/重装扩展或换 profile 后，即使固定 SQLite 仍存在，也必须重新显式 join；数据库存在本身不是授权。Local Database 没有“关闭后自动回退 IDB”的兼容模式。

## SQLite 全文搜索

Local mode 的全文搜索是 SQLite facts 上的**可重建关键词索引**：每个 conversation 的 title 与稳定 message 顺序合成 FTS document。它不是 vector database，不生成 embedding，也不会为了查询调用 OAuth provider、Notion、Feishu、Obsidian 或网络搜索服务。FTS index 丢失或不可用时，facts 本身仍可继续按既有事务语义保存；search 返回结构化 `FTS_UNAVAILABLE`，后续授权的 facts/schema/import transaction 才能重建派生索引，不能偷偷切换 tokenizer、`LIKE` 全表扫描或 IDB fallback。

搜索输入只接受共享 normalizer 产生的 NFC literal，最多 512 Unicode scalar。三字符及以上使用由 Host 生成的 quoted FTS phrase；浏览器不能提交 raw `MATCH` grammar、SQL、数据库路径或 HTML snippet。一到两个 scalar 的查询不走 FTS，而是在按更新时间倒序的固定 500 个 candidate 内做参数化 `instr()` literal 检查；如果 candidate cap 截断了范围，结果显式返回 `truncatedByScanLimit`。

搜索分页与 excerpt 使用独立安全预算，代码真源在 `src/services/local-data/contracts.ts` 与 `packages/syncnoscli/src/sqlite/search.ts`：

- 每页最多 50 个 result；cursor 绑定 normalized literal、source/site、best/recent sort、SQLite schema 和该 snapshot 的 `factsRevision`。任一绑定或 revision 改变都返回 `STALE_SEARCH_CURSOR`，UI 只提示用户显式重新提交，不自动混页或重搜。
- 每个 plain search snippet 最多 4 KiB UTF-8；Host 围绕命中裁剪后重新验证 UTF-16 code-unit、half-open `[start,end)` highlight，不能切开 surrogate pair，也不返回 HTML markup。
- background → UI 的 ordinary search response 最多 256 KiB UTF-8；超限返回 `PAYLOAD_TOO_LARGE`，不会静默丢 facet 或把大页塞进 runtime message。
- 完整 conversation preview 不属于 search result。它先用 `source + conversationKey` 重新解析当前 facts identity，再复用 detail 的 authenticated Port stream；单个 detail/preview 总上限 64 MiB。关闭 Sheet、新提交或外部 facts revision refresh 都会使旧 request 失效，晚到结果不得覆盖当前状态。

搜索只做关键词检索，不承诺 remote search、embedding、semantic/vector retrieval，也没有把查询发送给 provider 的路径。

## 写入与备份

- 完整采集可用快照同步；不完整的虚拟列表采集只能追加已验证的 diff，不能删掉旧消息。
- 图片缓存不改变会话主 facts，失败不阻断文本写入。
- Zip 备份包含本地会话、mapping、图片缓存、评论线程与非敏感设置；导入是 conservative merge，不是覆盖。
- 备份和迁移必须拒绝危险 Zip 路径、校验 manifest/schema/digest/byte ceiling，并保留无法恢复的资产为明确降级，而不是写入坏数据。
- SyncNos CLI 对既有 SQLite 的 `conversations list/get`、`stats` 和 `search` 使用同一 repository 语义；普通只读命令不能修改 facts、revision 或修复 FTS。

## 凭据与权限

- OAuth token、client secret 和任何以 token 前缀命名的键必须从备份和日志中排除。
- 官方 OAuth 的 secret 只放在 Worker secret；用户自建 Feishu 应用的 secret 可在本机保存，但仍不得备份或记录。
- Browser runtime 请求不能携带 SQLite path、raw SQL、browser profile UUID 或 Host origin override；Native Host 使用固定 contract 与固定本机数据库位置。
- `wxt.config.ts` 是 permissions、host permissions 和 web-accessible resources 的真源。修改权限时评估新增的信任边界，并运行完整构建验证。
