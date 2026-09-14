# 仓库指南

贡献流程、提交规范和通用验证要求统一见 [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)。本文件只维护代码架构、不可破坏契约和 agent 特有的实现约束。

## 分层与依赖方向

- `src/ui/**`：React 组件、样式和 DOM surface。
- `src/viewmodels/**`：UI 状态编排，只调用 service。
- `src/services/**`：业务流程、协议和可复用算法。
- `src/platform/**`：浏览器 runtime、storage、messaging、IndexedDB 等适配。
- `src/collectors/**`：站点 DOM 采集与视频字幕解析。
- `src/entrypoints/**`：background、content、popup、app 等装配入口。

依赖方向必须保持：

```text
ui -> viewmodels -> services -> platform/domain/client/shared
entrypoints -> ui/viewmodels/services/platform
collectors -> services/shared
```

禁止：

- `src/ui/**` 或 `src/viewmodels/**` import `@platform/*`。
- `src/services/**` import `@ui/*` 或 `@viewmodels/*`。
- 把可复用数据处理留在组件内。

路径别名：`@ui/*`、`@viewmodels/*`、`@services/*`、`@platform/*`、`@collectors/*`、`@entrypoints/*`、`@i18n/*`。

## 必须保持的契约

- UI 圆角只使用 `src/ui/styles/tokens.css` 中的 `--radius-*`；细则见 `src/ui/AGENTS.md`。
- 会话列表必须使用 `bootstrap + loadMore` 分页，禁止恢复全量读取。
- ChatGPT 与 Google AI Studio 的虚拟列表会卸载离屏轮次，禁止加入 `AI_CHAT_AUTO_SAVE_COLLECTOR_IDS`。Google AI Studio 完整历史继续只走手动 `prepareManualCapture()`；ChatGPT 默认也走手动 DOM `prepareManualCapture()`，仅用户显式开启 Advanced API 后，手动抓取才可改用已验证的 current-conversation backend mapping，并且不得静默回退 DOM。
- AI 对话正文持久化不得等待图片网络；ChatGPT 未缓存内容图片保留可恢复身份，禁止持久化临时 signed URL / session credential。用户上传和 AI 生成图片属于内容，普通 tool/MCP 截图与视觉执行产物不属于内容。完整图片缓存、导出和失败语义见 [`docs/storage.md`](docs/storage.md)。
- 评论选区只附加到根评论 composer；reply 输入框和评论面板内选区不得覆盖正文引用。
- 根评论允许仅划线：正文引用可在评论正文为空时保存，但必须有可验证的定位或稳定导入身份；reply 仍必须有非空正文。
- 评论定位只接受全局唯一 exact Range，不新增模糊匹配、比例滚动或父元素高亮回退。
- `$` mention 使用 `$` 打开候选，`Tab`/`Enter` 插入；站点支持真源在 `src/collectors/ai-chat-sites.ts`。
- `markdown_reading_profile_v1` 未知值归一到 `medium`。
- `anti_hotlink_rules_v1` 命中后补 Referer 并尝试缓存图片，但图片失败不得阻断正文采集。
- Provider 手动/自动同步必须复用同一 orchestrator / SyncJob 生命周期；不得另写第二套 progress/terminal state，也不得让共享 lifecycle 改写 Provider 原有事务、并发或远端写入语义。
- Local CLI / Native Messaging 只是 Extension 的本机入口：Extension/IndexedDB 仍是唯一业务真源，不创建第二套业务数据库；installer 只操作有限、声明过的当前用户 registration target，machine-safe response 不泄露 Provider/Reader secret。
- Notion 受管数据库字段与 section 不支持用户自定义其 schema/结构。旧 `Date: date` 且缺少 `Last Activity` 时直接重命名；managed section list/retrieve 失败必须传播或重试，不能当作“未找到”后创建重复 section。
- IndexedDB 业务层统一借用 canonical connection；受 revision 跟踪的业务变更与 revision 必须同 transaction 提交，consumer 以 durable revision + canonical reread 为事实真源。恢复/失败语义见 [`docs/storage.md`](docs/storage.md)。

## AI-Agent-first CLI contract

- `syncnos` 的主要调用者是 AI Agent，不以人类交互式终端体验作为 API 设计前提。普通 operational command 的 canonical contract 是稳定、最小、可机器解析的 JSON envelope `{ ok, data, error }`；`--human` 只作 secondary/debug presentation，不能反过来决定数据模型，也不能要求 TTY、pager、ANSI 或交互式 prompt。
- 任何可能无界增长的 query 都必须在实现层 bounded。存在 continuation 时，Agent 只原样回传 CLI 返回的 cursor，不解析内部编码；完整文件级交付使用 `export` / `backup export`，不能靠省略 `--limit` 隐式触发全量 JSON。Exact read/mutation 使用 CLI 返回的 conversation/comment identity；实例缺失或歧义必须 fail closed。
- Agent 只表达业务意图，不要求它选择 IndexedDB、runtime message、Native Messaging manifest/Registry path、IPC frame 或其它内部 routing。公开能力与参数以 `syncnos --help`、`syncnos capabilities`、`syncnos settings schema` 为真源；本机安装/连接诊断统一走 `doctor`。
- Machine-safe 成功与失败都通过 stdout 的 JSON envelope 返回，错误必须有稳定 `error.code` 和必要的结构化 `error.extra`；未来若增加纯诊断文本，不得污染 machine stdout。大文件通过 path/file-transfer 契约交付，不把 ZIP/Base64 打到终端。
- State-changing command 必须返回可 read-back 的业务结果。`sync` 默认等待本次 accepted job id 到 terminal state；只有调用者明确要求异步时才使用 `--no-wait`，timeout 不等于取消。mutation outcome unknown 时先正式 read-back，不猜测性重复同一 mutation。

## Repository Skill 规范

- `skills/syncnos/SKILL.md` 与 `skills/syncnos-zh/SKILL.md` 是给 AI **使用 `syncnos`** 的运行说明，不是开发者设计文档。正文只保留会直接影响正确调用的内容：`--help` / `capabilities` 路由、JSON/error 解释、instance 选择、state-changing command 的授权/等待/read-back，以及 installation/browser-required 分支。
- 不在 Skill 复制架构、IndexedDB/schema、内部 RPC/frame/type、浏览器矩阵与具体 manifest/Registry path、实现历史、task/commit 或测试清单。内部边界只有在调用者不知道它就会误用 CLI 时才保留最短规则；动态命令面由 CLI 自己输出，长期实现事实回到仓库 canonical docs/source。
- 新建 Skill 或 reference 前先确认有独立调用场景；已有 Skill 能覆盖就不要再建。创建或实质更新时遵循 `$skill-creator` 的最小化与渐进式披露原则，不为“文档齐全”新增 README、quick reference、changelog 或命令副本。
- 只有命令路由、JSON/error contract、instance 选择、安装/权限流程、写入/sync 或其它会改变 AI 调用方式的用户可见行为变化才触发 Skill 更新；纯内部重构、schema、资源预算或测试变化不触发。英文 `skills/syncnos/` 与中文 `skills/syncnos-zh/` 必须保持语义同步，目录名分别对应 frontmatter `name: syncnos` / `name: syncnos-zh`。
- 修改 Skill 后按 `$skill-creator` 对中英文目录分别运行 `quick_validate.ts`，并至少运行 Markdown 对应的 `npm run format:check`；若 Skill 更新源于 CLI package/installer/Native Messaging contract 变化，同时按 [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) 运行 `npm run cli:check` 与相称 gate。

## Agent 实现约束

- 默认不查看或编辑 i18n 文案，除非任务明确涉及文案。
- 修改 `website/content/docs/**` 时，按用户任务而不是内部模块组织信息；大范围重组先盘点真实用户可见功能，重要独立功能必须能从 Docs 导航或入口页直接发现。长期归属见 [`docs/GENERATION.md`](docs/GENERATION.md)，验证责任见 [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md)。
- 新 API、新状态或新文件必须接入生产入口；不要留下只被测试引用、没有生产消费者的实现。

## 架构自检

通用验证矩阵见 [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)。涉及对应边界时额外运行：

```bash
rg -n "@platform/|src/platform|/platform/" src/ui src/viewmodels
rg -n "@ui/|@viewmodels/" src/services
rg -n "border-radius:\\s*[0-9]|tw-rounded-\\[" src/ui src/entrypoints
```
