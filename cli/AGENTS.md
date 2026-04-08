## 产品定位

让本地 AI agent（Claude Code / Codex 等）通过 shell 命令与 SyncNos 浏览器扩展交互：采集网页、查询/搜索已保存内容、读取正文和评论、触发同步。

- **用户**：AI agent，通过 shell 命令调用
- **配套**：一份 skill 文档教 AI agent 怎么用 CLI
- **分发**：`npm install -g syncnos`

## 架构：Native Messaging Bridge

```
AI Agent ──shell──→ syncnos CLI ──HTTP──→ syncnos-bridge ──stdio──→ 扩展 background
                     (Node.js)        (localhost:PORT)      (Native Messaging)
                                      写端口到 ~/.syncnos/port
```

- **syncnos-bridge**：注册为 Native Messaging host，由扩展 `connectNative` 拉起；同时开 [localhost](http://localhost) HTTP server
- **syncnos CLI**：读 `~/.syncnos/port`，发 HTTP 请求到 bridge，拿结果输出到 stdout
- **扩展侧**：background.ts 新增 `CLI_MESSAGE_TYPES` 消息组，处理 fetch/list/show/search/sync 指令
- **三端支持**：Native Messaging 是 WebExtension 标准，Chrome / Firefox / Edge 都支持

### 为什么选 Native Messaging Bridge？

MV3 扩展不能主动接受外部连接——只有扩展能调 `connectNative` 发起通信。所以需要一个 bridge 进程做中继：

1. 扩展启动时调 `connectNative("syncnos_bridge")`，浏览器拉起 bridge 进程，保持 stdin/stdout 双向通道
2. bridge 同时在 `localhost:PORT` 开 HTTP server，端口写入 `~/.syncnos/port`
3. CLI 每次执行读端口文件 → HTTP 请求 → bridge 转发 → 扩展处理 → 原路返回

### CLI 无状态

每次调用是独立进程，像 `git` 一样。AI agent 执行一条命令拿一个结果，不需要维持连接。

### 安全：auth token

bridge 的 [localhost](http://localhost) HTTP server 必须有认证，否则任何本机进程都能读取/删除用户数据：

1. bridge 启动时生成随机 auth token → 写到 `~/.syncnos/token`
2. CLI 每次请求带 `Authorization: Bearer <token>` header
3. bridge 校验 token，无效请求返回 401

### 消息大小：分块传输

Native Messaging 每条 stdin/stdout 消息最大 **1MB**。长对话、大备份包会超限。解法：

- bridge 协议支持分块：扩展将大 payload 切成 <900KB 的 chunks，逐条发给 bridge
- bridge HTTP 侧重新组装后返回完整响应给 CLI
- `backup` 特殊处理：扩展生成 zip 数据流 → 分块通过 stdio → bridge 写入本地文件 → CLI 读文件路径

### 多浏览器共存

如果 Chrome 和 Firefox 都装了 SyncNos，各自会 `connectNative` 拉起 bridge：

- 使用 per-browser port 文件：`~/.syncnos/chrome.port` / `~/.syncnos/firefox.port`（每个对应独立 auth token）
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

参考 feishu-doc-cli（`npx skills add` 分发 skill）和 Unix 哲学：

- **git 模型**：一个入口 `syncnos` + 子命令，不拆成多个独立工具——AI agent 需要一份 skill 对应一个工具
- **文本流是万能接口**：stdout 输出 markdown/JSON，stderr 输出错误，exit code 表示成败
- **每个子命令做好一件事**：`fetch` 只管采集，`show` 只管展示，`sync` 只管同步
- **Pipe-friendly**：`--json` 输出可被 `jq` 处理，`--body` 输出可直接 `>` 重定向到文件
- **危险操作默认 dry run**：`delete` / `restore` 默认只预览，加 `--confirm` 才执行
- **链接格式自动归一化**：不管传什么格式的 URL，CLI 内部统一处理
- **Skill 分发**：`npx skills add chiimagnus/syncnos`，agent 自动获得使用指南

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
syncnos list --cursor <cursor>   # 翻页（传上一次返回的 cursor）
```

### 搜索

```
syncnos search <keyword>         # 复用扩展 mention-search 逻辑
```

### 读取内容

```
syncnos show <id>                # 完整内容（metadata + 正文 markdown）
syncnos show <id> --body         # 仅正文（article_body 或全部 messages）
syncnos show <id> --comments     # 仅评论线程
syncnos show <id> --meta         # 仅元数据（标题、来源、URL、时间、消息数）
syncnos show <id> --body --limit 50 --offset 100  # 消息分页
```

> `<id>` 使用 conversationId（数字），`list` 时显示出来让 AI agent 传。
> 

### 导出

```jsx
syncnos export <id> -o ./               # 导出为 Markdown 文件（自动命名：{source}-{title}.md）
syncnos export <id> -o ./article.md     # 指定文件名
syncnos export --all -o ./exports/      # 批量导出所有会话到目录
```

> `export` 与 `show --body` 的区别：export 写文件（自动命名 + frontmatter 元数据头），show 输出到 stdout（纯内容，适合管道）。
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
syncnos restore <path>           # 预览导入（dry run：显示会 merge 多少条）
syncnos restore <path> --confirm # 确认执行 merge import
```

### 删除

```jsx
syncnos delete <id>              # dry run：只显示会删什么，不真删
syncnos delete <id> --confirm    # 加 --confirm 才真正删除
syncnos delete <id1> <id2> ...   # 批量（仍需 --confirm）
```

> 所有危险操作（delete / restore）默认 dry run，必须显式 `--confirm` 才执行。
> 

### 统计

```jsx
syncnos stats                    # 本地知识库概览（总 clips、chat/article 数、来源分布、Top 3 最长对话）
```

### 系统

```jsx
syncnos status                   # bridge 连接状态、扩展版本
syncnos config                   # 查看扩展配置（Notion/Obsidian 连接、各开关状态）
syncnos --json <任何命令>         # 全局 flag，输出 JSON 而非 markdown
syncnos --retry                  # 全局 flag，连接失败时自动重试（最多 3 次，间隔 5s）
syncnos --browser chrome/firefox # 全局 flag，多浏览器时指定连接目标
syncnos --help
```

## 输出格式

默认 markdown（AI 友好），`--json` 切换结构化输出。

### `syncnos list` markdown 示例

```
## Saved Conversations (1–20 of 142)

1. [id:37] [chat] ChatGPT — SyncNos 架构讨论 (32 messages, 2h ago)
2. [id:36] [chat] Claude — PINN 论文翻译 (18 messages, 5h ago)
3. [id:35] [article] sspai.com — AI 笔记工作流 (1d ago, 3 comments)
...

--- Next page: syncnos list --cursor eyJsYXN0... ---
```

### `syncnos show <id>` markdown 示例

```
# SyncNos 架构讨论
- Source: ChatGPT
- Captured: 2026-04-08 22:30
- Messages: 32
- URL: https://chat.openai.com/c/xxx

---

**User:** 我想给 SyncNos 加一个 CLI 版本...

**Assistant:** 这个想法很有意思...
```

### `syncnos show <id> --comments` markdown 示例

```
## Comments (3 threads)

### Thread 1 (quoted: "这段关于 PINN 的描述...")
- Chii: 这里的公式推导有问题，需要核实
  - Chii: 已确认，原文确实写错了

### Thread 2
- Chii: 值得分享给罗老师
```

## 分页策略

- `list` / `search`：cursor 分页（复用扩展 `getConversationListPage` 的 `{lastCapturedAt, id}` cursor）
- `show --body`：offset + limit 分页（消息按 sequence 排序，默认前 50 条）
- `show --comments`：不分页（评论量通常很小）
- 所有分页响应带 `hasMore` 标志 + 下一页参数

## 扩展侧改动

- `background.ts`：注册 `connectNative` + CLI message router
- `message-contracts.ts`：新增 `CLI_MESSAGE_TYPES` 消息组（FETCH / LIST / SEARCH / SHOW / EXPORT / SYNC / BACKUP / RESTORE / DELETE / STATS / STATUS / CONFIG）
- `wxt.config.ts`：新增 `nativeMessaging` 权限 + host manifest 生成
- content controller：新增"由 CLI 触发的采集"模式（强制缓存图片 + 采集完成回调）

## 新增文件

- `cli/`：CLI 入口、命令解析（commander.js）、HTTP client、markdown formatter
- `bridge/`：Native Messaging host、HTTP server、消息中继
- `cli/skill.md`：AI agent 使用指南
- 安装脚本：`postinstall` 自动注册 Native Messaging host manifest（macOS / Linux / Windows 三端），需处理：manifest 中 bridge 可执行文件的绝对路径解析、不同 OS 的 manifest 存放位置、权限问题（Linux 某些路径可能需要 sudo）

## 错误处理

- port 文件不存在 → `Error: Bridge not running. Ensure browser is open and SyncNos CLI mode is enabled in Settings.`
- port 文件存在但连接被拒 → `Error: Bridge connection refused (stale port). Browser may have restarted. Waiting for reconnect...`（配合 `--retry`）
- auth token 无效 → `Error: Authentication failed. Try reinstalling: npm install -g syncnos`
- Native Messaging 消息超 1MB → bridge 自动分块，对 CLI 透明
- Notion 未授权 → sync 返回具体缺失项（token / parent page）
- fetch 超时 → 默认 30s，可 `--timeout 60` 调整
- fetch URL 需要登录 → 返回抓取结果但附带警告 `Warning: Page may require authentication`
- 所有错误走 stderr，exit code 非 0

### Exit codes

| Code | 含义 |
| --- | --- |
| 0 | 成功 |
| 1 | 一般错误（命令参数错误等） |
| 2 | bridge 未连接 / 连接失败 |
| 3 | 扩展返回错误（fetch 失败、sync 失败等） |
| 4 | 认证失败 |

## 测试策略

- **单测**：CLI 命令解析、markdown formatter、bridge 消息序列化
- **集成测**：bridge ↔ 扩展通信（mock stdin/stdout）
- **冒烟**：`syncnos status` 检测扩展连接

## Phase 规划

| Phase | 内容 |
| --- | --- |
| **P1** | bridge（含 auth token + 分块传输 + 多浏览器 port）+ SW keepalive + fetch（含 tab 管理）+ list + search + show（body/comments/meta）+ export + stats + status + config + skill 文档 |
| **P2** | sync（Notion / Obsidian）+ backup / restore（分块传输）+ delete（dry run）+ 写入评论 |
| **P3** | 批量操作、高级搜索、`--watch` 实时监听新采集 |

## Feature slug

`cli-native-messaging`