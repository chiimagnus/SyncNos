# 模块：文章评论 / 注释线程

## 职责
- 为 WebClipper 的 article 会话提供本地优先的 threaded comments（React 实现）。
- 允许用户在 article detail 或 inpage comments panel 中添加、回复、删除评论；评论记录可选保存 `locator`（TextQuote/TextPosition selectors）用于恢复选区与上下文，但**不维护持久高亮回显**。
- 当前定位是**local-first 注释层**：它是 article 会话的一部分，会在 article 同步时进入 Notion / Obsidian 的评论区段（含根评论数统计），并继续跟随 Zip v2 备份 / 导入保留。
- **2026-04 完成 React 迁移**：从 ~1,340 行 DOM 操作迁移到 ~950 行 React 组件，删除了 legacy `render.ts`（543 行），引入 `useSyncExternalStore` + panel store 架构。

## 关键文件

| 路径 | 作用 | 为什么重要 |
| --- | --- | --- |
| `src/ui/comments/panel.ts` | React 桥接入口 | 从 ~803 行缩减到 ~100 行，仅保留 `mountThreadedCommentsPanel` 作为 React 挂载点 |
| `src/ui/comments/react/ThreadedCommentsPanel.tsx` | 评论主组件（~810 行） | 完整的 React 组件：composer、threads、replies、删除确认、Chat with AI 菜单、聚焦逻辑 |
| `src/ui/comments/react/panel-store.ts` | 外部 store（~99 行） | 实现 `getSnapshot/subscribe` 模式，桥接 background handlers 与 React 渲染 |
| `src/ui/comments/react/focus-rules.ts` | 聚焦规则（~34 行） | 保存后自动聚焦、回复后聚焦目标输入框、pending focus 解析 |
| `src/ui/comments/react/comment-chatwith-menu.tsx` | 评论级 Chat with AI 菜单 | 支持单条评论+回复上下文打包发送到 AI 平台 |
| `src/services/comments/domain/comment-metrics.ts` | 评论数统计 | `computeArticleCommentThreadCount` 计算根评论数，用于 Notion/Obsidian 同步 |
| `src/services/comments/data/storage-idb.ts` | 评论存储层 | 负责 `article_comments` 的本地读写、查询、附着 orphan 评论、列表附加 `commentThreadCount` |
| `src/services/comments/background/handlers.ts` | 评论消息路由 | 把 add / list / delete / attach-orphan 等消息接到 IndexedDB |
| `src/services/comments/client/repo.ts` | UI 侧客户端仓库 | 给 React 组件提供 add / list / delete API |
| `src/ui/conversations/ArticleCommentsSection.tsx` | article 详情评论区 | 在 article detail 中展示和刷新本地评论线程 |
| `src/ui/inpage/inpage-comments-panel-shadow.ts` | inpage comments 面板壳 | 让页面内评论面板运行在独立 shadow root 中 |
| `src/services/comments/sidebar/comment-sidebar-session.ts` | 评论侧边栏共享会话 | 统一 open / close / quote / focus / busy 语义，让 app 与 inpage 共用同一协议 |
| `src/services/bootstrap/inpage-comments-panel-content-handlers.ts` | inpage comments content bridge | 负责打开 panel、解析选区、首次解析 article 后附着 orphan 评论 |
| `src/services/integrations/chatwith/chatwith-comment-actions.ts` | 评论级 Chat with AI 载荷 | 构建评论+上下文的 Chat with AI payload，支持多平台选择 |
| `src/services/sync/notion/notion-sync-orchestrator.ts` | Notion 同步 | 同步时加载评论并计算 `commentThreadCount`，写入 Notion "Comment Threads" 属性 |
| `src/services/sync/obsidian/obsidian-markdown-writer.ts` | Obsidian 写入 | frontmatter 写入 `comments_root_count`，Markdown 包含 `## Comments` 章节 |
| `src/platform/messaging/message-contracts.ts` | 消息契约 | 定义 `COMMENTS_MESSAGE_TYPES` 与 `CONTENT_MESSAGE_TYPES.OPEN_INPAGE_COMMENTS_PANEL` |
| `src/platform/idb/schema.ts` | IndexedDB schema | 在 `DB_VERSION = 7` 时创建 `article_comments` store 和索引 |
| `src/services/sync/backup/export.ts` / `import.ts` | 备份导出 / 导入 | Zip v2 把 `article_comments` 归档到 `assets/article-comments/index.json` |

## 存储模型

| 项目 | 说明 | 备注 |
| --- | --- | --- |
| store 名称 | `article_comments` | WebClipper 的独立 object store |
| 主键 | `id` 自增 | 便于回复树与删除操作 |
| 主要字段 | `canonicalUrl`, `conversationId`, `parentId`, `authorName?`, `quoteText`, `commentText`, `locator?`, `createdAt`, `updatedAt` | `canonicalUrl` 会去掉 hash 后再归一；`locator` 是可选的可恢复选区信息 |
| 索引 | `by_canonicalUrl_createdAt`, `by_conversationId_createdAt` | 支持按 article 和按会话两种读取路径 |
| 线程关系 | `parentId` | `null` 表示 root comment；非空表示 reply |
| orphan 处理 | `conversationId = null` | 页面未解析出会话时先落本地，随后 attach |

- `article_comments` 是 article 的本地注释层，会在 article 同步时参与 Notion / Obsidian 评论区段更新，并随 Zip v2 备份 / 导入一起保留。
- **Notion 同步**：conversation 对象携带 `commentThreadCount`，写入 Notion "Comment Threads" 属性（数字类型）。
- **Obsidian 写入**：frontmatter 包含 `comments_root_count`，Markdown 包含 `## Comments` 章节。
- 旧版或被裁剪的 Zip v2 备份如果缺少 `assets/article-comments/index.json`，恢复时仍会丢失评论线程；排查时先看 manifest。

## React 架构

### 组件结构
```
ThreadedCommentsPanel (React Component)
├── Composer (根评论输入框)
│   ├── textarea (commentText)
│   ├── send button (带防重入保护)
│   └── loading state (actionInFlightRef)
├── CommentThread (根评论 + 回复列表)
│   ├── CommentItem
│   │   ├── 评论文本 / locator 引用
│   │   ├── 回复按钮 / 删除按钮（二次确认）
│   │   └── Chat with AI 菜单（评论级）
│   └── ReplyComposer (回复输入框)
│       ├── textarea (replyText)
│       └── send button (自动聚焦+滚动)
└── DeleteConfirmDialog (删除二次确认)
    ├── armedDeleteId 状态
    └── confirm / cancel 按钮
```

### Panel Store 模式
```typescript
// panel-store.ts 提供外部 store，桥接到 React
interface CommentsPanelState {
  open: boolean;
  busy: boolean;
  comments: ArticleComment[];
  handlers: CommentsHandlers | null;
  focusComposerSignal: number;
  pendingFocusRootId: string | null;
}

// 使用 useSyncExternalStore 连接
const snapshot = useSyncExternalStore(
  panelStore.subscribe,
  panelStore.getSnapshot
);
```

### 防重入保护
```typescript
// 所有异步操作都通过 runBusyTask 包装
const runBusyTask = async <T>(task: () => Promise<T>): Promise<T> => {
  if (actionInFlightRef.current) return; // 防止并发
  actionInFlightRef.current = true;
  try {
    return await task();
  } finally {
    actionInFlightRef.current = false;
  }
};

// 删除操作使用 armedDeleteId 模式
const handleDelete = (commentId: string) => {
  if (armedDeleteId === commentId) {
    // 第二次点击，执行删除
    runBusyTask(() => handlers.deleteComment(commentId));
    setArmedDeleteId(null);
  } else {
    // 第一次点击，进入确认状态
    setArmedDeleteId(commentId);
  }
};
```

## 运行流程

### 文章详情页
1. `ArticleCommentsSection.tsx` 根据 `canonicalUrl` 读取评论列表，传递给 `ThreadedCommentsPanel`。
2. React 组件使用 panel store 管理状态，监听 `UI_EVENT_TYPES.CONVERSATIONS_CHANGED` 刷新。
3. 新评论和回复通过 `runBusyTask` 写入 IndexedDB，防止并发竞态。
4. 删除操作使用二次确认模式（`armedDeleteId`），防止误操作。
5. 发送后自动聚焦并滚动到目标 reply 输入框（`pendingReplyFocusRootIdRef`）。

### Inpage comments panel
1. 用户从页面内入口打开评论面板（例如双击 inpage 保存按钮打开评论侧边栏）。
2. `inpage-comments-panel-content-handlers.ts` 先解析选区 / `quoteText`，并生成可选 `locator`。
3. 若 article 还没建立 conversation，系统先捕获/解析 article，再附着 orphan 评论。
4. 面板的 open / close / quote / focus / busy 状态由 `comment-sidebar-session.ts` 统一调度。
5. React 组件通过 shadow root 渲染，与页面样式隔离。

### 评论级 Chat with AI
1. 用户点击评论项的 Chat with AI 菜单，选择目标平台。
2. `chatwith-comment-actions.ts` 构建 payload：该评论 + 所有回复 + 可选 article 上下文。
3. 内容渲染为 Markdown，按 `maxChars` 截断后复制到剪贴板。
4. 打开目标 AI 平台网站，用户手动粘贴提交。

## 消息契约

| 契约 | 作用 | 依赖方 |
| --- | --- | --- |
| `COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT` | 新增评论 / 回复 | `ThreadedCommentsPanel`, inpage comments panel |
| `COMMENTS_MESSAGE_TYPES.LIST_ARTICLE_COMMENTS` | 读取评论列表 | article detail, inpage comments panel |
| `COMMENTS_MESSAGE_TYPES.DELETE_ARTICLE_COMMENT` | 删除评论 | article detail, inpage comments panel |
| `COMMENTS_MESSAGE_TYPES.ATTACH_ORPHAN_ARTICLE_COMMENTS` | 把先前无 conversation 的评论附着到 article | inpage comments panel |
| `CONTENT_MESSAGE_TYPES.OPEN_INPAGE_COMMENTS_PANEL` | 打开页面内评论面板 | content controller（双击 inpage 按钮）/ context menu / content bridge |

- 评论相关消息通过 background handlers 统一落库，而不是直接在 UI 中操作 IndexedDB。
- `COMMENTS_MESSAGE_TYPES.LIST_ARTICLE_COMMENTS` 支持按 `canonicalUrl` 或 `conversationId` 读取。
- `UI_EVENT_TYPES.CONVERSATIONS_CHANGED` 会在新增 / 附着评论后广播，用来刷新 article detail。

## 聚焦规则

| 场景 | 行为 | 实现 |
| --- | --- | --- |
| 保存根评论后 | 清空输入框，不自动聚焦 | `resolveTargetRootIdFromSaveResult` 返回 null |
| 回复评论后 | 自动聚焦并滚动到被回复的评论输入框 | `resolveTargetRootIdForReply` 返回目标 rootId |
| 删除评论后 | 聚焦到相邻评论或输入框 | `resolvePendingFocusTarget` 查找最近的可用目标 |
| Escape 键 | 关闭删除确认/菜单，保留输入框文本 | `focusRules.ts` + `useLayoutEffect` 监听 |

## 测试与回归

| 文件 | 覆盖点 | 说明 |
| --- | --- | --- |
| `tests/storage/article-comments-idb.test.ts` | add / list / delete / replies / orphan attachment | 存储回归入口 |
| `tests/comments/panel-focus-rules.test.ts` | 聚焦规则解析 | 覆盖保存后聚焦、回复后聚焦、pending focus |
| `tests/smoke/comments-panel-react.test.ts` | React 组件冒烟 | 验证 mount/unmount、防重入、删除确认 |

- 评论线程改动至少要跑 `tests/storage/article-comments-idb.test.ts`。
- 若涉及 article comments 或 inpage 面板，建议再做一次 article detail + 页面内面板的人工冒烟。
- 备份 / 导入现在覆盖 `article_comments`；如果你在做恢复链路改动，要验证 `assets/article-comments/index.json` 与 `counts.article_comments` 都能正确往返。
- **React 迁移后**：legacy DOM 渲染已删除，不要再调用 `threaded-comments-panel.ts` 的旧 render 函数。

## 修改热点

| 要改什么 | 先看哪里 | 会影响谁 |
| --- | --- | --- |
| 评论数据结构 | `storage-idb.ts`, `schema.ts`, `article-comments-idb.test.ts` | 存储层、备份、同步 |
| 评论 UI 交互 | `ThreadedCommentsPanel.tsx`, `panel-store.ts`, `focus-rules.ts` | React 组件、聚焦规则 |
| 删除确认逻辑 | `ThreadedCommentsPanel.tsx` 的 `armedDeleteId` 状态 | 删除按钮、Escape 键处理 |
| 评论级 Chat with AI | `comment-chatwith-menu.tsx`, `chatwith-comment-actions.ts` | 平台选择、payload 构建 |
| 防重入保护 | `runBusyTask` + `actionInFlightRef` | 所有异步操作（保存/删除/回复） |
| 评论数同步到 Notion | `notion-sync-orchestrator.ts`, `comment-metrics.ts` | Notion 页面属性 |
| 评论数同步到 Obsidian | `obsidian-markdown-writer.ts` | frontmatter + Markdown 章节 |
| 备份 / 恢复评论线程 | `export.ts`, `import.ts`, `backup-utils.ts` | Zip v2 归档 |
| article detail UI | `ArticleCommentsSection.tsx` | 评论列表刷新 |
| 页面内评论面板 | `inpage-comments-panel-shadow.ts`, `comment-sidebar-session.ts` | shadow root、侧边栏状态 |
| 消息契约 | `message-contracts.ts`, background handlers | UI / background / content 三端 |

## 来源引用（Source References）
- `webclipper/src/ui/comments/panel.ts`
- `webclipper/src/ui/comments/react/ThreadedCommentsPanel.tsx`
- `webclipper/src/ui/comments/react/panel-store.ts`
- `webclipper/src/ui/comments/react/focus-rules.ts`
- `webclipper/src/ui/comments/react/comment-chatwith-menu.tsx`
- `webclipper/src/services/comments/domain/comment-metrics.ts`
- `webclipper/src/services/comments/data/storage-idb.ts`
- `webclipper/src/services/comments/background/handlers.ts`
- `webclipper/src/services/comments/client/repo.ts`
- `webclipper/src/services/comments/locator/selector-anchoring.ts`
- `webclipper/src/services/bootstrap/inpage-comments-panel-content-handlers.ts`
- `webclipper/src/services/comments/sidebar/comment-sidebar-session.ts`
- `webclipper/src/services/integrations/chatwith/chatwith-comment-actions.ts`
- `webclipper/src/services/sync/notion/notion-sync-orchestrator.ts`
- `webclipper/src/services/sync/obsidian/obsidian-markdown-writer.ts`
- `webclipper/src/services/sync/backup/export.ts`
- `webclipper/src/services/sync/backup/import.ts`
- `webclipper/src/services/sync/backup/backup-utils.ts`
- `webclipper/src/platform/idb/schema.ts`
- `webclipper/src/platform/messaging/message-contracts.ts`
- `webclipper/src/ui/conversations/ArticleCommentsSection.tsx`
- `webclipper/src/ui/inpage/inpage-comments-panel-shadow.ts`
- `webclipper/tests/storage/article-comments-idb.test.ts`
- `webclipper/tests/comments/panel-focus-rules.test.ts`

## 更新记录（Update Notes）
- 2026-04-04：评论模块完成 React 迁移——删除 legacy DOM render.ts（543 行），引入 `ThreadedCommentsPanel.tsx` + `panel-store.ts` + `focus-rules.ts` 架构；新增防重入保护（`runBusyTask`）、删除二次确认（`armedDeleteId`）、发送后自动聚焦；新增评论级 Chat with AI 菜单；评论数同步到 Notion（Comment Threads 属性）和 Obsidian（`comments_root_count` frontmatter）。
- 2026-03-29：补齐"inpage 双击保存按钮 → 打开页面内评论侧边栏"的入口说明，并同步 `OPEN_INPAGE_COMMENTS_PANEL` 的依赖方描述。
