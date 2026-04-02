# 仓库指南

SyncNos 目前以 `webclipper/` 为活动主线；`macOS/` 仅保留历史说明。

## 项目结构

```
SyncNos/
├── macOS/                       # 已归档历史代码
├── webclipper/                  # 当前活动的 Browser Extension (MV3)
├── .github/                     # 开发指南、deepwiki 与 CI
└── README.md
```

## 构建与运行

```bash
npm --prefix webclipper install              # 安装 WebClipper 依赖
npm --prefix webclipper run dev              # 启动 WebClipper Chrome 开发模式
npm --prefix webclipper run build            # 构建 WebClipper Chrome 产物
npm --prefix webclipper run compile          # TypeScript 编译检查
npm --prefix webclipper run test             # 单元测试
npm --prefix webclipper run check            # 产物校验
```

## 核心规范

| 规范 | 路径 |
|------|------|
| 仓库总览 | `README.md` |
| deepwiki 总入口 | `.github/deepwiki/INDEX.md` |
| deepwiki 业务入口 | `.github/deepwiki/business-context.md` |
| WebClipper 扩展 | `webclipper/AGENTS.md` |

## 开发工作流

### 先判断产品线

- 开始任何仓库级理解、规划、评审或文档改动前，先读 `.github/deepwiki/business-context.md`；需要继续展开时，再从 `.github/deepwiki/INDEX.md` 进入对应专题页。
- 一般情况下不需要全量通读 `.github/deepwiki/`；按 `.github/deepwiki/INDEX.md` 导航到最小必要页面即可。
- 修改 `webclipper/` 时，优先查看 `.github/deepwiki/modules/webclipper.md`、`webclipper/AGENTS.md`，先确认变更属于 `background`、`content`、`popup` 还是 `app`。
- `macOS/` 仅保留历史说明，不再作为当前代码更新目标。
- 若改动影响共享业务说明或仓库级入口文档，代码确认后同步更新相关 `AGENTS.md`、`.github/deepwiki/INDEX.md`、`.github/deepwiki/business-context.md` 与 `README.md`。

### WebClipper 工作流

1. 先确认职责边界：采集逻辑放 `collectors/content`，持久化与路由放 `background`，界面交互放 `popup` / `app`。
2. 权限、content scripts、消息协议、构建产物变更要同时检查 `wxt` 入口、manifest 结果与 CI 脚本是否一致。
3. Settings / Conversations UI 改动时，不要只改单个组件；同时核对这些真源：
   - `webclipper/src/viewmodels/settings/types.ts`（section 分组与顺序）
   - `webclipper/src/viewmodels/settings/useSettingsSceneController.ts`（`inpage_display_mode` / `ai_chat_auto_save_enabled` / `ai_chat_dollar_mention_enabled` / `ai_chat_cache_images_enabled` / `web_article_cache_images_enabled` / `chat_with_*`）
   - `webclipper/src/viewmodels/settings/insight-stats.ts`（Insight 统计口径）
   - `webclipper/src/services/integrations/chatwith/chatwith-settings.ts`（Chat with AI 模板 / 平台 / 截断）
   - `webclipper/src/services/integrations/item-mention/**`（`$ mention`：站点门控、候选搜索、插入载荷构建）
   - `webclipper/src/ui/styles/tokens.css`（主题 token：仅跟随 `prefers-color-scheme`）
   - `webclipper/src/ui/shared/SelectMenu.tsx`（source/site 筛选菜单的 `adaptiveMaxHeight` 与可视区域计算）
   - `webclipper/src/ui/popup/PopupShell.tsx` / `webclipper/src/ui/app/AppShell.tsx`（列表统计跳转 Insight 的路由入口）
   - `webclipper/src/ui/conversations/ConversationListPane.tsx` / `pending-open.ts`（来源筛选持久化与窄屏 detail bridge）
   - `webclipper/src/viewmodels/conversations/conversations-context.tsx` / `DetailHeaderActionBar.tsx` / `DetailNavigationHeader.tsx`（详情头 `open / tools` 槽位分发与窄屏一致性；Chat with AI 动作也复用 `tools` 槽位）
4. 默认验证顺序使用：
   - `npm --prefix webclipper run compile`
   - `npm --prefix webclipper run test`
   - `npm --prefix webclipper run build`
5. 若改动涉及 Firefox、发布打包、manifest/content script 重写或产物完整性，再补：
   - `npm --prefix webclipper run build:firefox`
   - `npm --prefix webclipper run check`
6. 发布包与 AMO Source 包由 GitHub Actions 和 `.github/scripts/webclipper/*.mjs` 负责，本地以开发验证为主。

### 文档同步工作流

1. 先从代码和脚本确认实际行为，再更新文档，不根据旧文档互相抄写。
2. 涉及仓库级行为变化时，优先同步这些入口文档：
   - `AGENTS.md`
   - `.github/deepwiki/INDEX.md`
   - `.github/deepwiki/business-context.md`
   - `webclipper/AGENTS.md`
   - `README.md`
3. 若 WebClipper 改动涉及设置结构、视觉 tokens、主题模式或共享按钮/导航样式，再同步：
   - `webclipper/src/ui/AGENTS.md`
   - `README.zh-CN.md`
4. 未被明确要求时，不要查看或编辑国际化字段。
5. 对版本号、DB 版本、权限、迁移等易过期事实，优先在 deepwiki 维护单一权威描述；其他入口文档只保留导航与原则，避免多处写死造成漂移。

## 常用命令

### WebClipper 开发与验证

- 安装依赖：`npm --prefix webclipper install`
- Chrome 开发模式：`npm --prefix webclipper run dev`
- Firefox 开发模式：`npm --prefix webclipper run dev:firefox`
- TypeScript 编译检查：`npm --prefix webclipper run compile`
- 单元测试：`npm --prefix webclipper run test`
- Chrome 构建：`npm --prefix webclipper run build`
- Firefox 构建：`npm --prefix webclipper run build:firefox`
- 产物校验：`npm --prefix webclipper run check`

### WebClipper 发布相关脚本

- Chrome/Firefox 发布产物打包：`node .github/scripts/webclipper/package-release-assets.mjs`
- AMO Source 包：`node .github/scripts/webclipper/package-amo-source.mjs`
- AMO 发布：`node .github/scripts/webclipper/publish-amo.mjs`
- Edge 发布：`node .github/scripts/webclipper/publish-edge.mjs`

## 测试

当前仓库无强制自动化测试套件，但功能改动需要完成以下验证：

- 单元测试优先覆盖 WebClipper 的核心逻辑（数据转换、状态变化、边界条件），通过协议 + 依赖注入 + Mock 隔离外部依赖。至少覆盖三类场景：数据转换、状态变化、边界条件（空数据、重复数据、异常数据）
- 使用 React/Vitest 的组件或页面预览做 UI 人工验证，至少覆盖加载态、错误态、空态和主流程态。
- 每次改动后执行最小冒烟：扩展可启动、关键数据源可读取、至少一次采集或同步成功、失败路径提示正确。
- 构建校验命令：`npm --prefix webclipper run compile && npm --prefix webclipper run test && npm --prefix webclipper run build`。
