# 故障排查

## 症状索引
| 症状 | 可能范围 | 首查位置 | 快速判断 |
| --- | --- | --- | --- |
| App 中同步入口不可用或一开始就失败 | Notion 授权 / Parent Page | `.github/docs/business-logic.md`, `SyncNos/AGENTS.md` | 看是否已完成授权并选择 Parent Page。 |
| Apple Books / GoodLinks 没有读到内容 | 目录授权 / 本地数据库 | `AGENTS.md`, `SyncNos/AGENTS.md` | 先确认 macOS 目录权限和来源库是否可读。 |
| WeRead / Dedao 登录态失效 | Keychain Cookie / SiteLogins | `SiteLoginsStore.swift`, `SyncNos/AGENTS.md` | 若 Cookie Header 失效，需要重新登录。 |
| 聊天 OCR 历史数据异常或导入后不全 | Chats 存储升级 / OCR | `ChatCacheService.swift`, OCR 技术文档 | 若经历 v3 minimal 升级，旧 OCR 原始 JSON 不会保留。 |
| WebClipper 页面内按钮没出现 | content script / `inpage_supported_only` | `Extensions/WebClipper/AGENTS.md`, `content.ts` | 开关切换后要刷新页面，新页面才会读取配置。 |
| Obsidian `Test` 失败或 `Failed to fetch` | Local REST API 配置 | `LocalRestAPI.zh.md` | 重点核对 `http://127.0.0.1:27123`、Insecure HTTP、API Key。 |
| WebClipper 发布 workflow 报版本不匹配 | tag / manifest version | `webclipper-amo-publish.yml`, `webclipper-cws-publish.yml` | 核对 `wxt.config.ts` 里的 `version` 是否等于 tag 去掉 `v`。 |
| 关闭 App 时被拦住 | App 正在同步 | `AppDelegate.swift` | `syncActivityMonitor.isSyncing` 为真时会弹确认框。 |

## 先做哪几步
1. **先判断产品线**：如果问题发生在桌面窗口、Notion 同步队列、OCR 或数据源登录，优先走 App 线；如果问题发生在浏览器页面、popup、导出、Obsidian 或商店打包，优先走 WebClipper 线。
2. **先判断是配置问题还是代码问题**：很多“功能没反应”其实是授权、Parent Page、页面刷新、API Key、tag 版本不一致，而不是逻辑 bug。
3. **先找事实源**：App 先查 UserDefaults / Keychain / SwiftData 缓存与 UI 状态；WebClipper 先查 IndexedDB、`chrome.storage.local`、popup 设置和 workflow 输出。

| 问题类型 | 先看页面 | 典型信号 |
| --- | --- | --- |
| 授权 / 配置 | `configuration.md` | 缺 Parent Page、API Key、URL scheme、manifest version 等 |
| 数据落点 / 本地库 | `storage.md` | 会话、缓存、Keychain、备份、迁移问题 |
| 同步 / 数据链路 | `data-flow.md` | 增量追加、重建、映射、删除联动问题 |
| 打包 / 发布 | `release.md` | tag、产物命名、商店上传失败 |

## SyncNos App：常见问题
### 1. 同步到 Notion 被阻止或立即失败
- 先确认是否已完成 Notion 授权并选择 Parent Page；共享业务文档明确规定，未授权或未选择 Parent Page 时所有写入入口都应该被阻止。
- 再确认具体来源是否已连通：Apple Books / GoodLinks 依赖目录权限，WeRead / Dedao 依赖登录 Cookie，Chats 依赖 OCR 导入数据。

### 2. 来源有内容但列表为空
- Apple Books / GoodLinks：优先检查目录授权和数据库可读性。
- WeRead / Dedao：优先检查 `SiteLoginsStore` 的 Cookie Header 是否仍然有效；该 store 在真正读取前才会从 Keychain 懒加载。
- Chats：如果用户经历过 `chats_v3_minimal.store` 的破坏性升级，需要确认是否已经重新导入旧截图或历史记录。

### 3. 关闭应用时被拦住
- 这通常不是 bug，而是 `AppDelegate.applicationShouldTerminate` 的保护逻辑：当 `syncActivityMonitor.isSyncing` 为真时，系统要求用户明确确认是否强制退出。
- 如果频繁发生，重点不是绕过弹窗，而是查“为什么同步长时间不结束”。

## WebClipper：常见问题
### 1. inpage 按钮不显示或设置没生效
- `content.ts` 对所有 `http(s)` 页面注入内容脚本，但是否真正启动 inpage controller 由运行时读取的 `inpage_supported_only` 决定。
- 该开关当前只在内容脚本启动时读取，所以切换后必须刷新当前页面或新开页面才能生效。

### 2. 会话能看到但同步到 Notion / Obsidian 异常
- Notion：先确认是否已连接 Notion、是否选中正确 kind，以及 cursor 是否匹配；业务文档明确说明 cursor 不匹配时会重建内容块。
- Obsidian：重点检查 `Base URL = http://127.0.0.1:27123`、插件已启用 `Insecure HTTP`、API Key 与 `Authorization` 头是否正确。
- 备份 / 恢复：Zip v2 为合并导入，不是覆盖导入；因此“导入后仍看到旧记录”通常是合并行为而非失败。

### 3. 本地数据在升级后看起来异常
- IndexedDB v3 专门迁移 NotionAI thread，会把 legacy conversation key 重写成 stable key，并迁移 `sync_mappings`。
- 若问题只出现在 NotionAI 或重复映射上，优先看 `schema.ts` 与 `schema-migration.test.ts` 的迁移逻辑，而不是先怀疑 UI。

## 构建与发布问题
| 症状 | 首查位置 | 说明 |
| --- | --- | --- |
| `npm run build` 过了，但上线后商店发布失败 | `release.md`, 发布 workflows | 本地构建不代表 tag / manifest / secrets 都正确。 |
| `manifest version mismatch` | `wxt.config.ts`, `webclipper-amo-publish.yml`, `webclipper-cws-publish.yml` | 商店 workflow 会强制校验 tag 与 manifest version。 |
| Firefox AMO 校验报 background / gecko 问题 | `package-release-assets.mjs` | 需确认 Firefox manifest patch 是否生效。 |
| `check` 失败但 `build` 成功 | `Extensions/WebClipper/package.json`, repo memory | `check` 会校验 build 产物与 manifest / icons，覆盖面比 build 更广。 |

## 恢复与安全清理
| 操作 | 适用场景 | 安全性 | 备注 |
| --- | --- | --- | --- |
| 重新授权 Notion / 重新选择 Parent Page | App / 扩展同步入口被阻止 | 安全 | 优先解决“无目标落点”的问题。 |
| 重新登录 WeRead / Dedao / GoodLinks | Cookie Header 过期 | 安全 | `SiteLoginsStore` 会把新 Cookie 保存到统一 Keychain store。 |
| 刷新页面 / 新开页面 | inpage 配置切换后不生效 | 安全 | 当前实现不做热更新。 |
| 重新导入 Chats 数据 | 遇到破坏性 OCR 存储升级 | 有成本但安全 | `chats_v3_minimal.store` 不保留旧 OCR JSON。 |
| 重跑 `compile -> test -> build` | WebClipper 本地构建异常 | 安全 | 先排除类型与测试回归。 |
| 回看 `storage.md` 确认事实源 | 本地库、映射、备份问题 | 安全 | 避免误把外部产物当本地事实源。 |

## 调试入口
| 入口 / 文件 | 适用问题 | 为什么先看这里 |
| --- | --- | --- |
| `SyncNos/AppDelegate.swift` | 同步中退出、URL callback、菜单栏模式 | 汇总 App 生命周期级保护逻辑。 |
| `SyncNos/Services/SiteLogins/SiteLoginsStore.swift` | 登录态、Cookie、域名映射 | 这里定义了 Keychain 结构和旧数据迁移。 |
| `SyncNos/Services/Auth/IAPService.swift` | 试用期、欢迎态、购买缓存 | 这里同时写 UserDefaults 和 Keychain。 |
| `Extensions/WebClipper/src/entrypoints/content.ts` | inpage、collector 启动、页面刷新问题 | 这里决定内容脚本的运行边界。 |
| `Extensions/WebClipper/src/platform/idb/schema.ts` | 数据库升级、NotionAI 会话迁移 | 所有 IndexedDB 版本变更都在这里。 |
| `Extensions/WebClipper/tests/storage/schema-migration.test.ts` | 迁移后的行为是否符合预期 | 最能验证“升级导致的问题”是否本来就被覆盖。 |
| `.github/workflows/webclipper-*.yml` | 发布失败 | 汇总版本校验、秘密变量和打包顺序。 |

## 示例片段
### 片段 1：App 在同步进行中不会静默退出
```swift
if !DIContainer.shared.syncActivityMonitor.isSyncing {
    return .terminateNow
}

presentQuitAlert()
return .terminateLater
```

### 片段 2：商店发布前会显式阻断版本不一致
```js
const tagVersion = String(tagName || "").replace(/^v/, "");
if (manifestVersion !== tagVersion) {
  throw new Error(`manifest version mismatch: wxt=${manifestVersion} tag=${tagVersion}`);
}
```

## Coverage Gaps（如有）
- 当前排障页已经覆盖最常见的配置、存储与发布问题，但尚未拆分专门的“Notion API 故障矩阵”或“OCR 识别故障矩阵”。
- 若未来 SyncNos 的日志体系或诊断界面更丰富，可以继续把“日志定位路径”和“手工恢复 SOP”拆成独立页面。

## 来源引用（Source References）
- `.github/docs/business-logic.md`
- `AGENTS.md`
- `SyncNos/AGENTS.md`
- `SyncNos/AppDelegate.swift`
- `SyncNos/Services/SiteLogins/SiteLoginsStore.swift`
- `SyncNos/Services/Auth/IAPService.swift`
- `SyncNos/Services/DataSources-From/Chats/ChatCacheService.swift`
- `Extensions/WebClipper/AGENTS.md`
- `Extensions/WebClipper/src/entrypoints/content.ts`
- `Extensions/WebClipper/src/platform/idb/schema.ts`
- `Extensions/WebClipper/tests/storage/schema-migration.test.ts`
- `.github/guide/obsidian/LocalRestAPI.zh.md`
- `.github/workflows/webclipper-release.yml`
- `.github/workflows/webclipper-amo-publish.yml`
- `.github/workflows/webclipper-cws-publish.yml`
