# Sync Process Refactor

## 原始问题

Notion 同步没有出现 conversation title 丢失，但 GitHub 同步出现了 `对话 #1617` 这类只有内部 ID、没有真实 title 的反馈。这个问题按理不应该取决于同步目标，因此需要从共享同步进度架构上解决，而不是给 GitHub 或 UI 单独打补丁。

## 重构前已确认的根因

重构前，项目实际上已经统一了 SyncJob 的“数据结构”和“消费端”：

- `SyncJobSnapshot`
- `SyncPerConversationResult`
- `sync-job-store`
- background messaging
- `useConversationSyncFeedback`
- `ConversationSyncFeedbackNotice`

UI 会优先显示 `currentConversationTitle` / `perConversation[].conversationTitle`，只有上游没有 title 时才 fallback 到 `对话 #<id>`。background → UI 的传输也不会主动删除 title。

真正的问题是：**四个 provider 只共享了 SyncJob 类型，却各自在 orchestrator 中重新手写 SyncJob 的生产和状态转换逻辑。**

也就是：

| 层 | 重构前状态 |
| --- | --- |
| SyncJob 类型 | 已统一 |
| SyncJob storage | 已统一 |
| background → UI | 已统一 |
| ViewModel / UI | 已统一 |
| current item / title / stage / result 生命周期 | 各 provider 自己实现 |

Notion、GitHub、Feishu、Obsidian 当时都分别维护：claim job、current conversation、title、stage、`perConversation`、`okCount/failCount` 和 terminal job。重复实现已经产生行为漂移。

### GitHub 为什么会暴露这个问题

GitHub 的 `stageResolved()` 会先批量处理所有 conversation，再进行一次 Git transaction。它在 staging 循环期间没有像 Notion 那样逐 item 持续维护统一 SyncJob 的 conversation identity。

更关键的是，GitHub 的失败分支会这样重新生成 item：

```ts
{
  conversationId,
  conversationTitle: '',
  status: 'failed',
  ...
}
```

因此即使 conversation 已经成功加载、真实 title 已经拿到，只要后面的 markdown projection / staging 失败，catch 仍会主动把已知 title 清空。`github_internal_asset_ref_unresolved` 就属于这种“conversation 已读取成功，后续 projection 才失败”的情况。

最终 `toJobRows()` 只能把空 title 写入 terminal `perConversation`，UI 因此只能 fallback 到 `对话 #1617`。

### 为什么 Notion 正常

Notion 在加载到 conversation 后，会立刻把真实 title 写回 running job，并在后续各 stage 和最终 result 中持续携带该 identity。所以后续即使失败，失败记录通常仍然知道对应的 conversation title。

这证明问题不是 GitHub 目标本身，而是 provider 对同一 SyncJob 契约的实现不一致。

另外，Feishu 也已经存在类似风险：异常分支会重新构造空 `conversationTitle`。这进一步说明 #1617 只是共享架构问题首先在 GitHub 上暴露出来。

## 根治方案（已实施）

### 核心原则

**统一 SyncJob 的 item identity / progress 生命周期，不统一各 provider 的远端同步事务。**

Notion 可以继续逐 conversation 调用 Notion API；GitHub 也必须继续保留“多条 conversation 先 staging，再一次 Git commit”的 batch transaction。不能为了统一 UI 进度而破坏各 provider 本身合理的同步模型。

最终统一的是与同步目标无关的公共生命周期：

```text
begin item
  ↓
记录 conversationId
  ↓
加载 conversation
  ↓
一旦拿到 title，就固定当前 item identity
  ↓
provider 只更新自己的 currentStage
  ↓
成功 / 失败通过同一 completion 路径结束 item
  ↓
统一维护 perConversation + counts
  ↓
整个 run 统一收尾 terminal job
```

### 1. 建立共享 Sync Job Progress / Item Lifecycle

最终在 `src/services/sync/sync-job-lifecycle.ts` 落地 `createSyncJobLifecycle()`，统一维护：

- `currentConversationId`
- `currentConversationTitle`
- `currentStage`
- `perConversation`
- `okCount`
- `failCount`
- `updatedAt`

它必须保证以下不变量：

1. 一旦真实 `conversationTitle` 已知，后续 stage 或异常路径不得把它无故退化为空。
2. success / failure result 必须继承当前 item 已知的 identity。
3. `currentStage` 可以是 provider-specific string，但 stage 更新不能覆盖 identity。
4. success / failure 通过统一 item completion 入口维护 `perConversation` 和计数。
5. terminal job 应由统一 lifecycle 中已经积累的结果收尾，而不是各 provider 再手写一份公共状态。

最终生产 API 收敛为：

```ts
lifecycle.setItem(conversationId, { conversationTitle, currentStage })
lifecycle.setRunStage(currentStage)
lifecycle.recordResult(result)
lifecycle.completeItem(result)
lifecycle.finishItem(conversationId)
lifecycle.finish(rows)
lifecycle.failPending(error)
lifecycle.summary()
lifecycle.titleFor(conversationId)
```

没有保留只为测试或迁移服务的 `beginItem` / `snapshot()` 等过渡 API，也没有建立第二套 progress event 框架。

### 2. Provider 只负责业务同步逻辑

最终职责已经收敛为：

```text
共享 SyncJob lifecycle
├── running / terminal
├── current item identity
├── progress persistence
└── result/count accumulation

Provider orchestrator
├── Notion：database/page/block
├── GitHub：projection/staging/batch commit/mapping ack
├── Feishu：document
└── Obsidian：vault/file
```

迁移每个 provider 时，同时删除了原来重复维护 identity、`perConversation`、counts、failure row 和 terminal job 的旧代码，避免新旧两套协议并存。Notion auto-sync 也不再自行生产第二套 SyncJob，而是与手动同步一样委托同一个 orchestrator。

### 3. GitHub 保留 batch commit 语义

GitHub 的一个 item 完成本地 staging，并不代表最终 `synced`，因为整批 transport 还没有提交。

因此共享 lifecycle 必须允许区分：

- 当前 item identity 已知；
- 本地 staging 已完成；
- batch transport 尚未结束；
- 最终 `synced / failed / mapping_failed`。

不能为了显示进度，把 `staged` 冒充 `synced`。运行期可以更新当前 conversation 的 ID/title/stage，但 terminal `perConversation` 的最终成功状态必须等 batch commit 和 mapping ack 完成后再确定。

## 明确不做

- 不在 `ConversationSyncFeedbackNotice` 增加 GitHub 特判。
- 不让 UI 根据 conversation ID 再查数据库补 title。
- 不把 GitHub batch commit 改成逐 conversation commit。
- 不重写各 provider 的远端同步算法。
- 不新增第二套独立于 `SyncJobSnapshot` 的 progress event / Port / message 协议。
- 不保留 provider 内旧的重复 progress 状态机作为“兼容层”。

## 验收结果

1. ✅ 四个 provider 使用同一套 item identity / progress lifecycle。
2. ✅ conversation 成功加载并取得 title 后，后续业务阶段失败不会再把 failure title 降级为空。
3. ✅ GitHub 在 `github_internal_asset_ref_unresolved` 等 projection failure 发生于 title 已知之后时，SyncJob failure 保留真实 title，UI 不再因此退化到 `对话 #<id>`。该 asset projection error 本身属于另一问题，不在本 feature 中伪装为已修复。
4. ✅ conversation 确实无法加载、identity 从未可知时，仍允许 fallback 到 `对话 #<id>`。
5. ✅ Notion 原有 title/progress 行为没有回归，并保留两 worker 并发。
6. ✅ Feishu / Obsidian 异常路径覆盖相同 identity-preservation invariant。
7. ✅ GitHub batch commit / mapping ack 语义保持，running progress 没有把 staged 冒充 synced。
8. ✅ `sync-job-store`、messaging、ViewModel、UI 没有增加 provider-specific title 修复；ViewModel 反而删除了预填第一条 conversation ID 的假 current item。
9. ✅ 自动化测试覆盖 lifecycle title 单调性、并发 identity 隔离、result/count 归一化、晚期失败、Notion 并发顺序/进度、各 provider 回归和 UI queue-preparation 状态。

## 最终实施与清理结果

除了四个 provider 接入共享 lifecycle，本次审计继续删除了会让旧架构死灰复燃的残留：

- provider-specific `*-sync-job-store.ts` 转发文件与重复 store 实现；
- Notion 第二套 result/progress normalizer、result index pipeline、auto-sync job producer 和 test-only default orchestrator；
- Feishu / Obsidian 重复 result/summary builder、default API 与静态 module adapter；
- background 中重复的 provider orchestrator/store 装配；
- 已无调用者的 auto-sync hook、旧 schema 兼容、假 optional dependency、Notion `any` 类型逃逸与重复 Chat database schema；
- 只有测试消费者、没有生产入口的同步辅助代码与过时测试 mock。

保留的 legacy 路径只用于仍然存在的用户数据兼容/迁移，例如旧 Notion 页面结构、旧 Obsidian note path 与 backup/schema migration；这些不是本次可删除的死代码。

最终验证：

- `npm run gate:ci` ✅
- ESLint / Prettier / TypeScript ✅
- Vitest：261 / 261 test files，1755 / 1755 tests ✅
- `git diff --check` ✅
- 关键手动同步行为已验收，包括多会话同步、title preservation、GitHub batch 行为、Notion 并发/auto-sync、Feishu 与 Obsidian 正常同步路径。

交付状态：

- 功能 PR：#527 `重构：统一同步任务生命周期并清理冗余实现`，已合并。
- 长期文档 follow-up：#528 `docs: 对齐同步生命周期长期契约`。
- 长期维护约束已经进入 `AGENTS.md`，对应 PR 验证责任进入 `docs/CONTRIBUTING.md`；本文件继续作为 feature 的问题分析、设计与实施历史，不承担 canonical 架构文档职责。

## 最终判断

> **重构前，项目只统一了 SyncJob 的“数据结构”，没有统一 SyncJob 的“生产与状态转换逻辑”；重构后，四个 provider 的 conversation identity、progress result 和 job state transition 已收敛到共享 SyncJob lifecycle。**

同步目标现在只决定“怎么同步”；通用的同步进度数据如何保存、已知 identity 如何保持、结果与计数如何收尾，由共享 lifecycle 负责。Provider 自己合理的事务、并发和远端写入语义继续保持独立。