## 产品定位

让本地 AI agent（Claude Code / Codex 等）通过 shell 命令与 SyncNos 浏览器扩展交互：采集网页、查询/搜索已保存内容、读取正文和评论、触发同步、导出与备份。

- **用户**：AI agent，通过 shell 命令调用
- **配套**：一份 skill 文档（`cli/skill.md`），随 CLI 一起分发
- **分发**：`npm install -g syncnos` + `npx skills add chiimagnus/syncnos`

## P0：Monorepo 重构

CLI 和扩展共用同一套类型、契约和工具代码。第一步先把仓库从单包结构转成 monorepo。

### 目标结构

```
SyncNos/
  shared/                        # @syncnos/shared
    src/
      types.ts                   # Conversation, Message, Comment 接口
      contracts.ts               # CLI_MESSAGE_TYPES + bridge 协议 + requestId
      formatting.ts              # markdown-it 渲染（浏览器无关）
      url-normalize.ts           # URL 归一化
    package.json                 # { "name": "@syncnos/shared" }
  webclipper/                    # 浏览器扩展（现有代码）
    src/
      entrypoints/
      services/
      ...
    package.json                 # 加 "@syncnos/shared": "workspace:*"
    wxt.config.ts
  cli/                           # CLI + bridge（同一个 npm 包）
    src/
      cli.ts                     # commander.js 入口 → bin: syncnos
      bridge.ts                  # Native Messaging host + HTTP server → bin: syncnos-bridge
      formatter.ts               # markdown 输出格式化
    skill.md                     # AI agent 使用指南
    package.json                 # { "name": "syncnos", "bin": { "syncnos": ..., "syncnos-bridge": ... } }
  package.json                   # { "private": true, "workspaces": ["shared", "webclipper", "cli"] }
```

### 从 webclipper 抽到 shared 的内容

| 抽出内容 | 来源文件 | 原因 |
| --- | --- | --- |
| Conversation / Message / Comment 类型 | `storage-idb.ts` 中的类型定义 | CLI 格式化响应、bridge 路由都需要 |
| `CLI_MESSAGE_TYPES`  • 现有消息类型 | `message-contracts.ts` | 扩展和 bridge 必须用同一套常量 |
| conversation kind 定义 | `conversation-kinds.ts` | chat/article 分类逻辑 |
| markdown 渲染工具 | `src/ui/shared/markdown.ts` | CLI 输出和扩展一致的格式 |
| URL 规范化逻辑 | 散落各处 | CLI 链接归一化 |
| backup manifest schema | `backup-utils.ts` | bridge 处理备份流需要知道格式 |

### 迁移步骤

1. 根目录加 `package.json`（workspaces）和 `shared/` 包
2. 从 `webclipper/src/` 抽取类型和工具到 `shared/src/`
3. `webclipper/` 内部 import 改为 `from '@syncnos/shared'`
4. 确认 webclipper 的 `compile` → `test` → `build` → `check` 全部通过
5. 新建 `cli/` 空包骨架

### 约束

- webclipper 的 WXT 构建必须能 resolve `@syncnos/shared`（Vite 支持 npm workspaces）
- 抽取只动**类型和纯函数**，不动浏览器绑定逻辑（IndexedDB、chrome.*、DOM）
- 现有测试不应受影响（类型抽取不改运行时行为）
- `~/.syncnos/` 目录权限 `0700`，token/port 文件权限 `0600`

## 架构：Native Messaging Bridge

```
AI Agent ──shell──→ syncnos CLI ──HTTP──→ syncnos-bridge ──stdio──→ 扩展 background
                     (cli/)          (localhost:PORT)      (Native Messaging)
                                      写端口到 ~/.syncnos/{browser}.port
```

- **syncnos-bridge**（`cli/src/bridge.ts`）：注册为 Native Messaging host，由扩展 `connectNative` 拉起；同时开 [localhost](http://localhost) HTTP server
- **syncnos CLI**（`cli/src/cli.ts`）：读 `~/.syncnos/{browser}.port`，发 HTTP 请求到 bridge，拿结果输出到 stdout
- **扩展侧**（`webclipper/`）：background.ts 新增 CLI message router，导入 `@syncnos/shared` 的消息类型
- **三端支持**：Native Messaging 是 WebExtension 标准，Chrome / Firefox / Edge 都支持

### 为什么选 Native Messaging？

MV3 扩展不能主动接受外部连接——只有扩展能调 `connectNative` 发起通信。所以需要一个 bridge 进程做中继：

1. 扩展启动时调 `connectNative("syncnos_bridge")`，浏览器拉起 bridge 进程，保持 stdin/stdout 双向通道
2. bridge 同时在 `localhost:PORT` 开 HTTP server，端口写入 `~/.syncnos/{browser}.port`
3. CLI 每次执行读端口文件 → HTTP 请求 → bridge 转发 → 扩展处理 → 原路返回

### CLI 无状态

每次调用是独立进程，像 `git` 一样。AI agent 执行一条命令拿一个结果，不需要维持连接。

### 安全

1. bridge 启动时生成随机 auth token → 写到 `~/.syncnos/{browser}.token`
2. CLI 每次请求带 `Authorization: Bearer <token>` header
3. bridge 校验 token，无效请求返回 401
4. `~/.syncnos/` 目录权限 `0700`，token/port 文件权限 `0600`

### 并发请求

AI agent 可能并行调用多条 CLI 命令。bridge 的 Native Messaging stdin/stdout 是单条流，必须做 request multiplexing：

- 每个 HTTP 请求分配唯一 `requestId`（来自 `@syncnos/shared/contracts`）
- bridge 将 `requestId` 附在 Native Messaging 消息中发给扩展
- 扩展响应带同一个 `requestId`
- bridge 按 `requestId` 路由响应回正确的 HTTP 连接

### 消息大小：分块传输

Native Messaging 每条 stdin/stdout 消息最大 **1MB**。长对话、大备份包会超限。解法：

- bridge 协议支持分块：扩展将大 payload 切成 <900KB 的 chunks，逐条发给 bridge
- bridge HTTP 侧重新组装后返回完整响应给 CLI
- **backup**（扩展 → CLI）：扩展生成 zip 数据流 → 分块通过 stdout → bridge 写入本地文件 → CLI 读文件路径
- **restore**（CLI → 扩展）：CLI 通过 HTTP 上传 zip → bridge 分块通过 stdin 发给扩展 → 扩展重组并 merge import

### 多浏览器共存

如果 Chrome 和 Firefox 都装了 SyncNos，各自会 `connectNative` 拉起独立 bridge：

- per-browser 文件：`~/.syncnos/chrome.port` + `chrome.token` / `firefox.port` + `firefox.token`
- CLI 默认连接第一个可用的 bridge，可通过 `--browser chrome/firefox` 指定
- bridge 启动时检测是否已有同浏览器的实例运行，有则直接退出

### Service Worker 休眠应对

MV3 service worker 空闲 5 分钟会休眠 → `connectNative` 断连 → bridge stdin 关闭 → bridge 进程退出 → port 文件变成僵尸。

完整应对链路：

1. bridge 退出时**主动删除** port 文件和 token 文件
2. 扩展设置中新增 **CLI 模式开关**：开启后用 `chrome.alarms`（30s 间隔）定期唤醒 SW 并检查/重建 `connectNative` 连接
3. CLI 检测到 port 文件不存在或连接被拒时，输出明确提示：`Bridge not running. Ensure browser is open and SyncNos CLI mode is enabled in Settings.`
4. CLI 支持 `--retry` flag：自动重试最多 3 次，间隔 5s，覆盖 SW 正在重连的窗口期

## 设计原则

参考 feishu-doc-cli 和 Unix 哲学：

- **代码共用**：类型、契约、格式化工具通过 `@syncnos/shared` 在扩展和 CLI 间复用
- **git 模型**：一个入口 `syncnos` + 子命令——AI agent 一份 skill 对应一个工具
- **文本流是万能接口**：stdout 输出 markdown/JSON，stderr 输出错误，exit code 表示成败
- **每个子命令做好一件事**：`fetch` 只管采集，`show` 只管展示，`sync` 只管同步
- **Pipe-friendly**：`--json` 输出可被 `jq` 处理，`--body` 输出可直接 `>` 重定向到文件
- **危险操作默认 dry run**：`delete` / `restore` 默认只预览，加 `--confirm` 才执行
- **链接格式自动归一化**：通过 `@syncnos/shared/url-normalize` 统一处理

## CLI 完整命令面

### 采集

```jsx
syncnos fetch <url>              # 扩展打开+采集+缓存图片，等完成返回内容（采集后自动关闭 tab）
syncnos fetch <url> --async      # 不等完成，立即返回 job id
syncnos fetch <url> --keep-tab   # 采集后保留 tab 不关闭
syncnos fetch status <job-id>    # 查异步 job 状态
```

> - fetch 默认强制缓存图片——CLI 发起的采集没有理由不缓存
> 

> - fetch 完成后默认**自动关闭 tab**，防止 AI agent 连续 fetch 开一堆标签页
> 

> - URL 需要浏览器登录态才能正常采集（和扩展手动抓取行为一致）
> 

### 查询列表

```
syncnos list                     # 列出最近会话（默认 20 条）
syncnos list --type chat         # 只列 AI chats
syncnos list --type article      # 只列 articles
syncnos list --source chatgpt    # 按来源筛选
syncnos list --limit 50          # 控制数量
syncnos list --cursor <cursor>   # 翻页
```

### 搜索

```
syncnos search <keyword>         # 复用扩展 mention-search 逻辑
```

### 读取内容

```
syncnos show <id>                # 完整内容（metadata + 正文 markdown）
syncnos show <id> --body         # 仅正文
syncnos show <id> --comments     # 仅评论线程
syncnos show <id> --meta         # 仅元数据
syncnos show <id> --body --limit 50 --offset 100  # 消息分页
```

> `<id>` 使用 conversationId（数字），`list` 时显示出来让 AI agent 传。
> 

### 导出

```jsx
syncnos export <id> -o ./               # Markdown 文件（自动命名 + frontmatter）
syncnos export <id> -o ./article.md     # 指定文件名
syncnos export --all -o ./exports/      # 批量导出
```

> export 写文件（自动命名 + frontmatter），show 输出到 stdout（纯内容，适合管道）。
> 

### 同步

```
syncnos sync <id>                # 同步到 Notion + Obsidian
syncnos sync <id> --notion       # 只同步到 Notion
syncnos sync <id> --obsidian     # 只同步到 Obsidian
syncnos sync --all               # 同步全部未同步的
```

### 备份与恢复

```jsx
syncnos backup                   # 导出 Zip v2 备份包
syncnos backup -o ~/backups/     # 指定输出路径
syncnos restore <path>           # dry run：显示会 merge 多少条
syncnos restore <path> --confirm # 确认执行
```

### 删除

```jsx
syncnos delete <id>              # dry run：只显示会删什么
syncnos delete <id> --confirm    # 真正删除
syncnos delete <id1> <id2> ...   # 批量（仍需 --confirm）
```

> 所有危险操作（delete / restore）默认 dry run，必须显式 `--confirm` 才执行。
> 

### 统计

```jsx
syncnos stats                    # 本地知识库概览
```

### 系统

```jsx
syncnos status                   # bridge 连接状态、扩展版本
syncnos config                   # 查看扩展配置
syncnos --json <任何命令>         # 全局 flag，输出 JSON
syncnos --retry                  # 全局 flag，自动重试（最多 3 次，间隔 5s）
syncnos --browser chrome/firefox # 全局 flag，指定浏览器
syncnos --help
```

## 输出格式

默认 markdown（AI 友好），`--json` 切换结构化输出。

### `syncnos list` 示例

```
## Saved Conversations (1–20 of 142)

1. [id:37] [chat] ChatGPT — SyncNos 架构讨论 (32 messages, 2h ago)
2. [id:36] [chat] Claude — PINN 论文翻译 (18 messages, 5h ago)
3. [id:35] [article] sspai.com — AI 笔记工作流 (1d ago, 3 comments)
...

--- Next page: syncnos list --cursor eyJsYXN0... ---
```

### `syncnos show <id>` 示例

```
# SyncNos 架构讨论
- Source: ChatGPT
- Captured: 2026-04-08 22:30
- Messages: 32

---

**User:** 我想给 SyncNos 加一个 CLI 版本...

**Assistant:** 这个想法很有意思...
```

### `syncnos show <id> --comments` 示例

```
## Comments (3 threads)

### Thread 1 (quoted: "这段关于 PINN 的描述...")
- Chii: 这里的公式推导有问题
  - Chii: 已确认，原文确实写错了
```

## 分页策略

- `list` / `search`：cursor 分页（复用扩展的 `{lastCapturedAt, id}` cursor）
- `show --body`：offset + limit 分页（默认前 50 条）
- `show --comments`：不分页
- 所有分页响应带 `hasMore` 标志 + 下一页参数

## 扩展侧改动

- `background.ts`：注册 `connectNative` + CLI message router（导入 `@syncnos/shared`）
- `webclipper/` 的类型导入改为 `from '@syncnos/shared'`
- `wxt.config.ts`：新增 `nativeMessaging` 权限 + host manifest 生成
- content controller：新增 CLI 触发采集模式（强制缓存图片 + 自动关闭 tab + 完成回调）
- Settings：新增 CLI 模式开关（控制 `chrome.alarms` keepalive）

## 错误处理

- port 文件不存在 → `Error: Bridge not running. Ensure browser is open and SyncNos CLI mode is enabled in Settings.`
- 连接被拒 → `Error: Bridge connection refused (stale port). Browser may have restarted.`（配合 `--retry`）
- auth 无效 → `Error: Authentication failed. Try reinstalling: npm install -g syncnos`
- 1MB 消息超限 → bridge 自动分块，对 CLI 透明
- Notion 未授权 → sync 返回具体缺失项
- fetch 超时 → 默认 30s，可 `--timeout 60`
- fetch 需要登录 → 附带警告 `Warning: Page may require authentication`
- 所有错误走 stderr，exit code 非 0

### Exit codes

| Code | 含义 |
| --- | --- |
| 0 | 成功 |
| 1 | 一般错误 |
| 2 | bridge 未连接 |
| 3 | 扩展返回错误 |
| 4 | 认证失败 |

## 测试策略

- **单测**：CLI 命令解析、markdown formatter、bridge 消息序列化、分块组装
- **集成测**：bridge ↔ 扩展通信（mock stdin/stdout）、requestId multiplexing
- **冒烟**：`syncnos status` 检测扩展连接
- **P0 回归**：monorepo 重构后 webclipper 的 `compile` → `test` → `build` → `check` 全部通过

## Phase 规划

| Phase | 内容 |
| --- | --- |
| **P0** | **monorepo 重构**：仓库转 `shared/`  • `webclipper/`  • `cli/` 结构，抽取共用类型和工具到 `@syncnos/shared`，确认 webclipper 构建/测试/发布不受影响 |
| **P1** | bridge（auth + 分块 + requestId + 多浏览器 port）+ SW keepalive + fetch（tab 管理）+ list + search + show（body/comments/meta）+ export + stats + status + config + skill 文档 |
| **P2** | sync（Notion / Obsidian）+ backup / restore（双向分块）+ delete（dry run）+ 写入评论 |
| **P3** | 批量操作、高级搜索、`--watch` 实时监听新采集 |

## Feature slug

`cli-native-messaging`