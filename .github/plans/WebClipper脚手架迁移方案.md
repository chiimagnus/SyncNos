# WebClipper 脚手架迁移方案（更新版：完全重构，但按增量落地）

> 目标共识：接入脚手架意味着**最终形态必然是一次“全量重构后的新工程结构”**；但为了降低 AI coding 与迁移失败风险，我们采用 **Strangler Fig（藤蔓式）渐进重构**：每一阶段都能跑、能构建、能回归核心能力，逐段替换旧实现，而不是一口气推倒重来。

## 0. Goal / Non-goals

### Goal（要达成什么）

- 把 WebClipper 从「IIFE + `globalThis.WebClipper` 手工装配 + 自研 concat 构建」迁移到 **WXT（Vite）脚手架**
- 构建一个扩展内 Web App：`chrome-extension://<id>/app.html`（SPA + Router）
  - 新增页面/新 Tab = 新增路由与业务模块
  - popup 变成快捷入口：常用动作 + 打开完整界面
- 多浏览器交付链清晰：Chrome / Edge / Firefox（本地 dev、构建、打包、商店交付）
- 业务能力不回归：采集 → 本地持久化 → 导出/Obsidian → Notion OAuth + Notion Sync → 备份/导入

### Non-goals（明确不做）

- 不做功能“再设计”（例如改默认开关、改交互约束、改去重规则）
- 不在迁移期引入新的数据源/新同步目标（除非为了验证架构必须）

---

## 1. 当前约束（必须遵守）

- 权限保持最小且明确：**迁移期先对齐现状，不新增也不“顺手精简”**；任何变更 permissions/host_permissions 都要有理由与验收（见 `Extensions/WebClipper/AGENTS.md`）
- 不持久化除 `chrome.storage.local` 外的任何密钥（OAuth token、API key 等不落 IndexedDB）
- inpage 交互约束不变（单例 tip、400ms combo 结算、双击打开 popup 不可用时提示等）
- 迁移期间：每个 Phase 结束都必须能构建 + 最小手测冒烟

---

## 2. 技术选型（最终形态）

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 脚手架 | WXT | 接管 manifest/多入口构建/多浏览器打包/dev reload；底层 Vite |
| UI 框架 | React（或 Preact alias） | “扩展内 Web App”可维护性优先；Router/生态成熟 |
| 语言 | TypeScript（strict） | 用类型约束模块边界，降低长期扩展成本 |
| 路由 | HashRouter | `chrome-extension://` 无 server fallback，Hash 最稳 |
| 状态 | Zustand（仅 UI 层） | 轻量；注意：background/content 不强行用 Zustand |
| 样式 | Tailwind（app/popup）+ Shadow DOM（inpage） | app/popup 快速迭代；inpage 隔离站点样式污染 |
| 测试 | Vitest（保留并扩展） | 继续用现有 `vitest`，迁移时补关键单测 |

---

## 3. 目录结构（按“业务分域”组织，而不是纯技术分层）

> 原则：未来你要加一个新页面（新 Tab）/新能力，应该主要在一个“业务域”内改动，而不是到处跨目录 import。

```
Extensions/WebClipper/
├── entrypoints/                       # WXT 入口（薄胶水）
│   ├── background.ts
│   ├── content.ts
│   ├── popup/                         # popup（轻量入口）
│   └── app/                           # app（扩展内 Web App）
├── src/
│   ├── platform/                      # 浏览器平台适配（runtime、storage、permissions、logging）
│   ├── domains/                       # 业务域（核心）
│   │   ├── conversations/             # 会话：采集快照、去重、列表/详情读模型
│   │   ├── sync/                      # 同步：job 状态、节流/重试、结果聚合
│   │   ├── backup/                    # 备份/导入：zip v2、legacy JSON 合并规则
│   │   └── settings/                  # 设置：敏感字段策略（不回显/只显示状态/提供清除）
│   ├── integrations/                  # 外部系统集成（按目标分）
│   │   ├── notion/
│   │   ├── obsidian/
│   │   └── web-article/
│   ├── collectors/                    # 平台采集器（按站点/平台分文件夹）
│   ├── ui/
│   │   ├── app/                       # app 页面与路由
│   │   ├── popup/                     # popup 组件
│   │   └── inpage/                    # content/inpage UI（Shadow DOM）
│   └── shared/                        # 无业务语义的纯工具（少量）
├── public/                            # 静态资源（icons、fonts）
├── tests/                             # Vitest（复用/迁移原有 tests）
├── wxt.config.ts
├── tsconfig.json
└── package.json
```

迁移期额外约定：

- 旧实现移动到 `src/legacy/`（只读 + 最小补丁），由新代码通过“适配层”调用；每完成一个域的替换，就删除对应 legacy。

---

## 4. 权限与 Host 权限策略（先写清楚，避免迁移回归）

### 4.1 当前扩展依赖的权限（迁移后必须保留）

> 以现状为准（见 `Extensions/WebClipper/manifest.json`）：`storage`, `downloads`, `tabs`, `webNavigation`, `activeTab`, `scripting`

迁移计划要求：

- Phase 0 就把这些权限在 `wxt.config.ts` 中完整声明出来（否则后续功能验证无意义）
- 不在迁移期“顺便精简权限”；精简作为迁移完成后的独立任务（有数据支撑与验收）

### 4.2 host_permissions（关于 `http(s)://*/*`）

现状已包含 `http://*/*` 与 `https://*/*`，且 inpage 默认在所有页面可见（`inpage_supported_only=false`）。因此：

- **迁移期不改默认行为** ⇒ host 权限继续需要覆盖全网页
- 后续若要“默认最小 host 权限 + 运行时申请 optional host 权限”，必须：
  - 明确行为变更（默认不再全站可见/或首次开启时弹权限）
  - 补 UI 引导与降级路径
  - 重做 content 注入策略（按需注入 vs 静态 content_scripts）

---

## 5. 迁移策略（每一步可运行、可回滚）

> 关键：不是“先把所有 JS 转 TS”，而是“先把交付形态稳定下来，再把业务域逐个 strangling 掉 legacy”。

### Phase 0：Spike 验证（0.5–1 天，必须先做）

- [ ] WXT 多入口：background/content/popup/app 能正常 dev 与 build
- [ ] 验证 WXT 对 “unlisted page（app）” 的入口约定与产物路径（不要靠猜）
- [ ] 验证 Firefox 交付链：构建、临时加载、基础功能可跑（至少 popup + background 路由 + storage）

验收：

- `dev` 下能从 popup 打开 `app`，HashRouter 路由可切换
- `build` 产物可在 Chrome 加载
- Firefox 临时扩展能加载并能打开 popup（不要求全功能，但要跑通核心通信链路）

#### Phase 0 Spike 结论记录（执行 Task 02/03 后填）

> 这里是“唯一允许写死路径/命令”的地方：先用 Spike 得到真实约定，再固化到本文与实施计划，避免猜测导致反复返工。

- WXT 入口约定（background/content/popup/app）：`TODO`
- `app.html`（unlisted page）产物路径与打开方式：`TODO`
- Firefox build 命令与产物目录：`TODO`

### Phase 1：建立“平台层”与消息协议（1–2 天）

- [ ] `src/platform/runtime`：统一 `sendMessage/connectPort`，屏蔽 `chrome`/`browser` 差异
- [ ] `src/platform/storage`：统一 `storage.local` 访问（包含敏感字段策略的 helper）
- [ ] `src/domains/*` 的接口先定义出来（只定义类型与边界，不搬代码）
- [ ] `message-contracts` 转 TS，并成为唯一消息 type 来源（禁止散落字符串）

验收：

- background 能注册 router，popup/app 能发送最小消息并得到响应

### Phase 2：先把“扩展内 Web App（app）”跑起来（1–2 天）

- [ ] app 路由骨架：`/`（Conversations）、`/sync`、`/settings`、`/debug`（先空壳）
- [ ] popup 增加一个“打开完整界面”按钮：`browser.runtime.getURL('app.html#...')`
- [ ] settings 页先只做“状态展示 + 清除”，不回显 token/apiKey

验收：

- app 可作为“未来扩展主界面”稳定打开与导航

### Phase 3：按业务域逐个替换 legacy（2–5 天，迭代）

按顺序建议：

1) conversations（读多写少）
2) sync jobs（Notion/Obsidian 状态）
3) export/backup（文件/zip）
4) collectors/inpage（最容易回归，最后做）

每个域的要求：

- [ ] 给域内核心逻辑补 3 类单测：数据转换 / 状态变化 / 边界条件
- [ ] 完成后删掉对应 legacy 子模块（避免双实现长期共存）

### Phase 4：迁移 inpage（最后做，单独验收）

- [ ] Shadow DOM 隔离样式
- [ ] 严格回归交互约束（400ms combo、单例 tip、双击打开等）

### Phase 5：替换构建链与发布链（收尾）

- [ ] 清理旧 `scripts/build.mjs`、`scripts/check.mjs`（在 WXT 完整覆盖后再删）
- [ ] 保留/重建 “Firefox AMO source package” 的可复现流程（迁移现有 `package-amo-source` 能力）
- [ ] 更新 `Extensions/WebClipper/AGENTS.md` 与 README（仅在新结构稳定后）

---

## 6. 关键配置草案（先写清“必须项”，细节在 Phase 0 Spike 后定稿）

### wxt.config.ts（迁移期必须包含完整权限）

> 迁移期先“对齐现状权限”，不要先做权限瘦身。

- permissions：`storage`, `downloads`, `tabs`, `webNavigation`, `activeTab`, `scripting`
- host_permissions：保留现状（含 `http(s)://*/*`）直到明确要改默认行为

---

## 7. 给 Codex 的执行指令（更新版，强调渐进与可回滚）

```
目标：在 Extensions/WebClipper 内 in-place 迁移到 WXT（不要新建 WebClipper-v2 目录），采用渐进式重构。

硬性要求：
1) 每个 Phase 结束都能 npm dev / npm run build / npm test 通过（优先复用现有 npm + package-lock，不强制切 pnpm）
2) wxt.config.ts 迁移期必须先对齐现状 permissions/host_permissions（不要提前“精简权限”）
3) 先做 Phase 0 Spike：验证 app（unlisted page）入口约定 + Firefox 构建与临时加载可跑
4) 目录结构按“业务分域”组织（domains/integrations/ui/platform），旧实现移到 src/legacy 并逐段删除
5) settings 页面敏感字段不回显，只展示状态与提供清除
```
