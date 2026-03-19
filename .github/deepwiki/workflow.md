# 工作流

## 协作入口

| 变更类型 | 先看哪里 | 为什么 |
| --- | --- | --- |
| 仓库级行为 / 共享业务规则 | [business-context.md](business-context.md), [INDEX.md](INDEX.md), `AGENTS.md`, `README.md` | 先用 deepwiki 建立上下文，再确认是不是同时影响两条产品线 |
| App 改动 | [modules/syncnos-app.md](modules/syncnos-app.md), `macOS/SyncNos/AGENTS.md`, `macOS/SyncNos/Services/AGENTS.md` | 先理解产品线边界，再遵守 MVVM、协议注入、SwiftData 后台访问约束 |
| WebClipper 改动 | [modules/webclipper.md](modules/webclipper.md), `webclipper/AGENTS.md` | 先理解运行时边界，再判断属于 background / content / popup / app 哪一层 |
| 发布 / 打包改动 | `.github/workflows/*.yml`, `.github/scripts/webclipper/*.mjs` | 防止本地流程与 CI 产物分叉 |
| 文档 / deepwiki 改动 | 代码 / 配置 / workflow → deepwiki | 文档必须以事实源为准，而不是彼此转述 |

## 仓库级文档工作流

| 步骤 | 动作 | 产出 |
| --- | --- | --- |
| 1 | 先核对代码、配置、脚本与 workflow | 明确真实行为 |
| 2 | 判断影响面是否跨产品线 | 决定是否要改 `AGENTS.md`、`README.md`、deepwiki |
| 3 | 用产品线边界组织叙述 | 避免把 App 约束和扩展约束混写 |
| 4 | 未被明确要求时不碰 i18n 字段 | 降低与任务无关的多语言改动风险 |
| 5 | 更新 deepwiki 时同步 `INDEX.md` 与 `GENERATION.md` | 保证知识入口和元数据一致 |
| 6 | 若 WebClipper 改动涉及设置结构、视觉 tokens、主题切换或 comments / detail UI，同时同步 `webclipper/AGENTS.md`、`webclipper/src/ui/AGENTS.md` 与 `modules/comments.md` | 避免执行文档和 UI 设计文档继续沿用旧规则 |

## SyncNos App 开发工作流

| 步骤 | 动作 | 关键约束 |
| --- | --- | --- |
| 1 | 先判断改动属于 `Models` / `Services` / `ViewModels` / `Views` | 不要跨层混杂职责 |
| 2 | 涉及 OCR、动态字体、键盘焦点、数据源、同步目标时先读专项文档 | 避免绕开已有约定 |
| 3 | 改业务逻辑时优先通过协议和 `DIContainer` 注入 | 避免引入新的全局耦合 |
| 4 | 至少做一次构建和最小人工冒烟 | 不要只靠静态阅读判断正确 |

## WebClipper 开发工作流

| 步骤 | 动作 | 关键约束 |
| --- | --- | --- |
| 1 | 先判断职责边界 | 采集进 `collectors/content`，持久化进 `background/conversations`，UI 进 `popup` / `app` |
| 2 | 涉及权限、消息协议、manifest、content scripts 时同步看 `wxt.config.ts` 和 workflow | 这些改动最容易本地成功、CI 失败 |
| 3 | 默认按 `compile` → `test` → `build` 验证 | 先查类型，再查逻辑，再查产物 |
| 4 | 涉及 Firefox / 商店发布 / manifest 重写时补 `build:firefox` 和 `check` | 防止渠道特定错误 |
| 5 | collector 改动要同时考虑自动采集、手动保存、popup 列表和同步下游 | 采集不是孤立层 |
| 6 | Settings / Conversations UI 改动要同时检查 `types.ts`、`useSettingsSceneController.ts`、`useThemeMode.ts`、`SelectMenu.tsx`、`PopupShell.tsx` / `AppShell.tsx`、`ConversationListPane.tsx` / `ConversationsScene.tsx`、`conversations-context.tsx`、`DetailHeaderActionBar.tsx` / `DetailNavigationHeader.tsx` | 这些文件共同定义设置分组与关键存储键（含 `ai_chat_cache_images_enabled`）、主题应用、详情头动作槽位、下拉可视高度策略、Insight 跳转入口、筛选持久化与窄屏路由桥接 |

## Deepwiki / 文档维护工作流

| 场景 | 应该怎么做 | 为什么 |
| --- | --- | --- |
| 初次进入仓库 / 新任务预读 | 先读 `business-context.md`，再按产品线进入 `modules/*.md`，最后回到 `AGENTS.md` | 先建立产品语义，再读取执行约束 |
| 新增或调整仓库级行为 | 先改代码 / 配置，再回写 deepwiki | 避免 deepwiki 成为旧事实 |
| 改动影响阅读路径 | 同步更新 `INDEX.md` | 让后续读者能正确进入相关页面 |
| 页面集合变化 | 同步更新 `GENERATION.md` | 便于下次增量更新对比 |
| 新增 WebClipper comments 子系统 | 同步更新 `modules/comments.md`、`modules/webclipper.md`、`storage.md`、`testing.md` | 避免 comments 相关事实散落在多页 |
| 改动影响 README、产品说明或 UI 设计原则 | 同步更新 `README.md` / `README.zh-CN.md` / `webclipper/src/ui/AGENTS.md` | 避免用户文档、执行文档、设计文档各讲各的 |
| 无法确认的区域 | 在 Coverage Gaps 里写明 | 防止 deepwiki 假装完整 |

## 发布与打包工作流

| 工作流 | 触发方式 | 主要动作 | 结果 |
| --- | --- | --- | --- |
| `release.yml` | `v*` tag / `workflow_dispatch` | 创建 GitHub Release 页面和静态链接体 | Release 页面 |
| `webclipper-release.yml` | `v*` tag / `workflow_dispatch` | 构建 Chrome / Edge / Firefox 资产并上传 Release | zip / xpi 附件 |
| `webclipper-amo-publish.yml` | `v*` tag / `workflow_dispatch` | 校验 manifest 版本、构建 XPI、打包 source zip、发布 AMO | Firefox 商店版本 |
| `webclipper-cws-publish.yml` | `v*` tag / `workflow_dispatch` | 校验 manifest 版本、构建 Chrome zip、上传 CWS | Chrome 商店版本 |
| `webclipper-edge-publish.yml` | `v*` tag / `workflow_dispatch` | 校验 manifest 版本、构建 Edge zip、上传/发布 Edge Add-ons | Edge 商店版本 |

## 常见决策点
- **是否需要改仓库级文档**：只要共享业务规则、主入口、验证顺序、发布链路或产品语义变了，就不应只改某个子目录里的说明。
- **是否需要改 CI / scripts**：如果变动 manifest、产物命名、商店渠道、打包参数，通常也要同步 `.github/workflows/` 与 `.github/scripts/webclipper/`。
- **是否需要新增权限**：WebClipper 默认强调最小权限 + 运行时 gating；新增权限前要能解释为什么现有权限无法满足需求。
- **是否需要调整模块边界**：App 保持 `Views → ViewModels → Services → Models`；扩展保持 collectors / conversations / sync / ui 的清晰拆分。
- **是否应该继续硬编码下拉高度**：如果菜单位于底部条、滚动容器或窄视口，优先沿用 `SelectMenu` 的 `adaptiveMaxHeight`，不要回退固定 `maxHeight`。
- **是否只在一个 header 改了动作按钮**：会话详情动作必须同时校验主详情页与窄屏 `DetailNavigationHeader`，并遵守 `open / chat-with / tools` 槽位约束，避免 popup/app 行为分叉。

## 来源引用（Source References）
- `AGENTS.md`
- `README.md`
- `macOS/SyncNos/AGENTS.md`
- `macOS/SyncNos/Services/AGENTS.md`
- `webclipper/AGENTS.md`
- `webclipper/package.json`
- `webclipper/wxt.config.ts`
- `webclipper/src/ui/settings/hooks/useSettingsSceneController.ts`
- `webclipper/src/ui/conversations/conversations-context.tsx`
- `webclipper/src/ui/conversations/DetailHeaderActionBar.tsx`
- `webclipper/src/ui/conversations/DetailNavigationHeader.tsx`
- `webclipper/src/comments/background/handlers.ts`
- `webclipper/src/comments/client/repo.ts`
- `webclipper/src/comments/data/storage-idb.ts`
- `webclipper/src/ui/conversations/ArticleCommentsSection.tsx`
- `webclipper/src/ui/comments/threaded-comments-panel.ts`
- `webclipper/src/ui/inpage/inpage-comments-panel-shadow.ts`
- `webclipper/src/ui/shared/SelectMenu.tsx`
- `.github/workflows/release.yml`
- `.github/workflows/webclipper-release.yml`
- `.github/workflows/webclipper-amo-publish.yml`
- `.github/workflows/webclipper-cws-publish.yml`
- `.github/workflows/webclipper-edge-publish.yml`
- `.github/scripts/webclipper/package-release-assets.mjs`
- `.github/scripts/webclipper/publish-edge.mjs`
