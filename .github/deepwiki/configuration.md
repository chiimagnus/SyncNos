# 配置

macOS/ 历史资料已归档；本页仅保留 WebClipper 的配置、版本与发布真源。

## 配置入口

| 配置面 | 路径 / 界面 | 存储位置 | 说明 |
| --- | --- | --- | --- |
| WebClipper manifest | `wxt.config.ts` | 代码配置 | 控制版本、权限、entrypointsDir、host permissions、manifest icons（`16/48/128`）与 `web_accessible_resources`（仅暴露 `icon-128.png`） |
| WebClipper 运行时设置 | SettingsScene + `src/viewmodels/settings/useSettingsSceneController.ts` + `chrome.storage.local` | 浏览器本地 KV | 控制 Notion parent page、Obsidian、`inpage_display_mode`、`ai_chat_auto_save_enabled`、`ai_chat_cache_images_enabled`、`web_article_cache_images_enabled`、Chat with AI、Notion AI 模型偏好 |
| WebClipper UI-only 状态 | `localStorage` / `sessionStorage` | 浏览器本地 Web Storage | 控制设置页当前 section、来源筛选、窄屏下待打开的 conversation |
| 发布参数 | `.github/workflows/*.yml` | workflow inputs / env | 控制 tag、Node 版本、CWS / AMO 行为 |

## WebClipper 配置项

| 配置项 | 位置 | 当前值 / 默认 | 作用 |
| --- | --- | --- | --- |
| `manifestVersion` | `wxt.config.ts` | `3` | 扩展固定在 MV3 模式 |
| `manifest.version` | `wxt.config.ts` | `1.5.1` | 商店 workflow 校验的版本事实源 |
| `entrypointsDir` | `wxt.config.ts` | `src/entrypoints` | 统一 background/content/popup/app 入口目录 |
| 安装后引导策略 | `src/entrypoints/background.ts` | `install` 打开 `/settings?section=aboutme`；`update` 不自动开标签页 | 保留首次上手引导，同时避免升级打断当前会话 |
| `inpage_display_mode` | `chrome.storage.local`, `src/services/bootstrap/content.ts` | 默认 `all`；兼容旧 `inpage_supported_only` | 控制 inpage 在 `supported / all / off` 三档中的显示范围 |
| `SelectMenu.adaptiveMaxHeight` | `ui/shared/SelectMenu.tsx`, `ConversationListPane.tsx` | 默认 `false`；source/site 筛选启用为 `true` | 在菜单展开时基于最近可裁剪容器动态计算 `panelMaxHeight`，减少多余滚动条与裁切 |
| `ai_chat_auto_save_enabled` | `chrome.storage.local` | 默认 `true` | 控制支持 AI 站点是否自动保存；关闭后仍可手动保存 |
| `ai_chat_dollar_mention_enabled` | `chrome.storage.local`, `src/services/bootstrap/content-controller.ts` | 默认 `true` | 控制支持站点的 `$ mention` 能力是否启用；关闭后 content script 会停止注入该交互（当前标签页可热更新） |
| `ai_chat_cache_images_enabled` | `chrome.storage.local`, `src/services/conversations/background/handlers.ts` | 默认 `false` | 控制 chat 消息采集时是否尝试图片内联；历史会话可通过 detail header 的 `cache-images` 手动回填 |
| `web_article_cache_images_enabled` | `chrome.storage.local`, `src/services/conversations/background/handlers.ts`, `src/collectors/web/article-fetch.ts` | 默认 `false` | 控制 article 消息采集时是否尝试图片内联；历史会话可通过 detail header 的 `cache-images` 手动回填 |
| `notion_parent_page_id`, `notion_parent_page_title` | `chrome.storage.local`, `src/viewmodels/settings/useSettingsSceneController.ts` | 用户选择值 | 决定扩展 Notion 的写入根 |
| `notion_oauth_client_id` | `chrome.storage.local`, `src/services/sync/notion/auth/oauth.ts` | 默认写入（best-effort） | Notion OAuth client id（扩展侧只保存 client id，不保存 secret） |
| `notion_oauth_pending_state` | `chrome.storage.local`, `src/viewmodels/settings/useSettingsSceneController.ts` + `src/services/sync/notion/auth/oauth.ts` | 连接中临时值 | OAuth 发起后写入，用于回调 state 校验与 UI polling 停止条件 |
| `notion_oauth_last_error` | `chrome.storage.local`, `src/viewmodels/settings/useSettingsSceneController.ts` + `src/services/sync/notion/auth/oauth.ts` | 空字符串或错误信息 | 记录最近一次 OAuth 回调/交换失败原因；UI 会据此展示状态并停止 polling |
| `notion_ai_preferred_model_index` | `chrome.storage.local` | 空字符串或正整数 | 控制 Notion AI model picker 偏好 |
| `chat_with_prompt_template_v1`, `chat_with_ai_platforms_v1`, `chat_with_max_chars_v1` | `src/services/integrations/chatwith/chatwith-settings.ts`, `chrome.storage.local` | 默认模板 + 平台清单 + `28000` | 控制 Chat with AI 的载荷模板、目标平台和截断长度 |
| `webclipper_sync_provider_notion_enabled` | `chrome.storage.local`, `src/services/sync/sync-provider-gate.ts` | 默认启用（缺省值） | Notion 同步 provider 门控（显式写 `false` 表示禁用） |
| `webclipper_sync_provider_obsidian_enabled` | `chrome.storage.local`, `src/services/sync/sync-provider-gate.ts` | 默认启用（缺省值） | Obsidian 同步 provider 门控（显式写 `false` 表示禁用） |
| `webclipper_settings_active_section` | `src/viewmodels/settings/types.ts`, `localStorage` | 默认 `general`；当前稳定值：`general / chat_with / backup / notion / obsidian / aboutyou / aboutme`（兼容旧 `insight / about`） | 记住设置页当前选中的 sidebar 分组 / section |
| `webclipper_conversations_source_filter_key` | `ConversationListPane.tsx`, `localStorage` | 默认 `all` | 记住会话列表来源筛选 |
| `webclipper_pending_open_conversation_id` | `pending-open.ts`, `sessionStorage` | 临时值 | 在窄屏 list/detail 路由之间桥接待打开的会话 |
| Insight 统计限制 | `src/viewmodels/settings/insight-stats.ts` | `INSIGHT_CHAT_SOURCE_LIMIT=4`, `INSIGHT_ARTICLE_DOMAIN_LIMIT=8`, `INSIGHT_TOP_CONVERSATION_LIMIT=3` | 控制平台来源排行、文章域名排行与 Top conversation 截断方式 |
| Obsidian 设置 | `obsidian*` settings store | `apiBaseUrl`, `authHeaderName`, `chatFolder`, `articleFolder`, 可选 API Key | 控制扩展写入本地 vault |
| 备份敏感键排除 | `src/services/sync/backup/backup-utils.ts` | 精确排除 `notion_oauth_token_v1`, `notion_oauth_client_secret`，且排除任何 `notion_oauth_token*` | 避免敏感信息进入备份 |

### 版本号单一事实源（Single Source of Truth）
- deepwiki 里 **只在本页**记录 WebClipper 的具体发版号（`manifest.version`）。
- 其他页面（如 `dependencies.md` / `release.md` / `testing.md`）只引用本页，不再重复写死版本值。
- 当版本变更时，只需要修改此处与源码 `webclipper/wxt.config.ts`，避免多处文档漂移。

- 扩展 UI 文案没有独立的“语言设置”键；`src/ui/i18n/index.ts` 会按 `navigator.language` 自动在 `en` / `zh` 间切换。
- 主题仅依赖 CSS 媒体查询：设计 token 在 `tokens.css` 里通过 `prefers-color-scheme` 统一切换，不再维护手动主题开关。
- Insight 不写入新的 `chrome.storage.local` 键；统计只在用户打开 `Settings → Insight` 时从 IndexedDB 现算，失败时回到错误态或空态。
- `ai_chat_cache_images_enabled` / `web_article_cache_images_enabled` 分别控制 chat/article 的消息内联策略；它们都不会回写新的设置键到 Insight 或列表筛选状态。
- `wxt.config.ts` 里 WebClipper 的 manifest icons 目前包含 `icon-16.png` / `icon-48.png` / `icon-128.png`；但出于跨站资源暴露收敛的考虑，`web_accessible_resources` 只暴露 `icons/icon-128.png`。

## 发布参数

| 参数 | 位置 | 值 / 规则 | 影响 |
| --- | --- | --- | --- |
| Release 触发条件 | `.github/workflows/release.yml` | `push tags: v*` 或 `workflow_dispatch` | 决定 GitHub Release 页面何时创建 |
| WebClipper CI Node 版本 | `webclipper-*.yml` | `20` | 保持构建与发布一致 |
| CWS `publish_target` | `webclipper-cws-publish.yml` | `default` / `trustedTesters` | 控制 Chrome Web Store 发布范围 |
| AMO channel | `webclipper-amo-publish.yml` | `listed` | 控制 Firefox 商店提交通道 |
| 版本一致性规则 | `webclipper-amo-publish.yml`, `webclipper-cws-publish.yml`, `webclipper-edge-publish.yml` | `tag 去掉 v == manifest.version` | 阻止错误版本发布 |

## 权限与安全边界

| 面 | 真实配置 | 安全意图 | 备注 |
| --- | --- | --- | --- |
| 扩展权限 | `storage`, `contextMenus`, `tabs`, `tabGroups`, `webNavigation`, `activeTab`, `scripting` | 尽量只保留采集与本地保存所需能力 | 新增权限必须解释原因 |
| 扩展 host permissions | 支持站点 + Notion + `http://*/*` + `https://*/*` | 允许 content script 在运行时自行判断是否激活 | UI 级别由 `inpage_display_mode` 做 gating（并兼容回读旧 `inpage_supported_only`） |
| 备份导入导出 | denylist + 前缀过滤 | 防止 OAuth token 跟随备份扩散 | Zip v2 仍保留非敏感运行设置 |

## 常见误配
- **改了 `wxt.config.ts` 的 `manifest.version` 却没对齐 tag**：CWS / AMO workflow 会直接报 `manifest version mismatch`。
- **以为扩展升级后会自动打开设置页**：`background.ts` 仅在首次安装（`details.reason === 'install'`）自动打开 About；更新不会自动弹出设置页。
- **切了 `inpage_display_mode` 或 `ai_chat_auto_save_enabled` 但当前页不变**：这些开关在 content bootstrap / controller 启动时读取，当前页面不会热更新；必须刷新或新开页面。
- **切了 `ai_chat_dollar_mention_enabled` 但当前页表现不一致**：该开关在 `content-controller.ts` 中会监听 `chrome.storage.onChanged`，通常无需刷新即可启停；但如果当前页因 `inpage_display_mode=off` 未启动 content controller，仍需刷新/重新进入支持站点后才会生效。
- **打开 `ai_chat_cache_images_enabled` / `web_article_cache_images_enabled` 后旧会话图片仍是外链**：这些开关主要影响后续采集写入；历史消息需要在 detail 里手动触发 `cache-images` 才会回填。
- **以为筛选下拉高度不再固定 `320px` 是样式异常**：`source/site` 筛选菜单现在显式启用 `adaptiveMaxHeight`，会随可视区域动态变化，这是预期行为。
- **只在 Settings 里连上 Notion、却没选 Parent Page**：扩展仍然不能真正写入 Notion 页面。
- **Obsidian 使用了错误的 URL / header / API Key**：当前设计默认围绕 `http://127.0.0.1:27123` 与 `Authorization` 头工作。
- **WebClipper 只改 UI 没考虑字体缩放或窗口模式**：新视图若没调用现有字体 / 窗口辅助能力，体验会与主窗口不一致。

## 示例片段
### 片段 1：WebClipper 的 manifest 权限和 host permissions 由 `wxt.config.ts` 直接声明
```ts
manifest: {
  version: '<manifest.version>',
  permissions: ['storage', 'contextMenus', 'tabs', 'tabGroups', 'webNavigation', 'activeTab', 'scripting'],
  host_permissions: ['https://chat.openai.com/*', 'https://api.notion.com/*', 'http://*/*', 'https://*/*']
}
```

### 片段 2：WebClipper 的版本事实源由 `wxt.config.ts` 维护
```ts
export default defineConfig({
  manifest: { version: '1.5.1' }
})
```

### 片段 3：筛选菜单会根据最近可裁剪容器动态计算可用高度
```ts
const clipRect = findNearestClippingRect(el);
const available = side === 'top'
  ? rect.top - (clipRect?.top ?? 0) - gap - margin
  : (clipRect?.bottom ?? window.innerHeight) - rect.bottom - gap - margin;

const next = Math.floor(Math.max(80, Number.isFinite(available) ? available : 160));
```

## 来源引用（Source References）
- `webclipper/wxt.config.ts`
- `webclipper/src/entrypoints/background.ts`
- `webclipper/src/services/bootstrap/content.ts`
- `webclipper/src/services/bootstrap/content-controller.ts`
- `webclipper/src/services/bootstrap/current-page-capture.ts`
- `webclipper/src/ui/i18n/index.ts`
- `webclipper/src/services/integrations/chatwith/chatwith-settings.ts`
- `webclipper/src/services/conversations/background/handlers.ts`
- `webclipper/src/services/conversations/background/image-backfill-job.ts`
- `webclipper/src/viewmodels/conversations/conversations-context.tsx`
- `webclipper/src/viewmodels/settings/types.ts`
- `webclipper/src/viewmodels/settings/useSettingsSceneController.ts`
- `webclipper/src/viewmodels/settings/insight-stats.ts`
- `webclipper/src/ui/conversations/ConversationListPane.tsx`
- `webclipper/src/ui/shared/MenuPopover.tsx`
- `webclipper/src/ui/shared/SelectMenu.tsx`
- `webclipper/src/ui/conversations/pending-open.ts`
- `webclipper/src/services/sync/backup/backup-utils.ts`
- `.github/workflows/release.yml`
- `.github/workflows/webclipper-release.yml`
- `.github/workflows/webclipper-amo-publish.yml`
- `.github/workflows/webclipper-cws-publish.yml`

## 更新记录（Update Notes）
- 2026-03-30：同步本页 `manifest.version` 单一事实源并对齐当前 tag；更新扩展安装后引导 deep-link（`/settings?section=aboutme`）与 Settings section key（`aboutyou/aboutme`），并补齐 Notion OAuth / Sync Provider gate 的存储键说明。
- 2026-03-29：更正 WebClipper manifest icons 事实（`16/48/128` 仍存在，仅 `icon-128.png` 暴露为 `web_accessible_resources`）；补齐 `$ mention` 开关键 `ai_chat_dollar_mention_enabled` 与其“可热更新”的行为边界。
- 2026-03-25：同步本页 `manifest.version` 单一事实源（对齐当时发布版本），并将 WebClipper 的旧目录引用统一迁移到 `src/services/*` 与 `src/ui/i18n/index.ts`。
- 2026-03-22：同步 WebClipper settings 真路径、Chat with AI 真路径，并将 README 的主题说明收敛为系统跟随。
- 2026-03-19：将 `manifest.version` 同步并补充 `AutoSyncService.intervalSeconds=5*60` 的 App 侧轮询事实与来源引用。
